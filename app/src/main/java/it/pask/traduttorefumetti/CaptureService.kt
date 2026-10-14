package it.pask.traduttorefumetti

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.graphics.Point
import android.graphics.Rect
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Looper
import android.provider.MediaStore
import android.util.Log
import android.view.Gravity
import android.view.WindowManager
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions
import com.google.mlkit.vision.text.latin.TextRecognizerOptions

/**
 * Cattura lo schermo, riconosce i balloon con ML Kit (sul telefono, inglese e giapponese),
 * li traduce e disegna la traduzione sopra. Lavora solo quando la pagina cambia e poi resta ferma.
 */
class CaptureService : Service() {

    private enum class State { WAITING, SHOWING }

    private lateinit var worker: HandlerThread
    private lateinit var handler: Handler
    private val mainHandler = Handler(Looper.getMainLooper())

    private lateinit var windowManager: WindowManager
    private var overlay: OverlayView? = null
    private var projection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var screen = Point()

    private lateinit var recognizer: TextRecognizer
    private lateinit var japanese: TextRecognizer
    private lateinit var ocr: ComicOcr
    private lateinit var translator: PageTranslator

    // Stato: "aspetta che la pagina sia ferma -> OCR -> traduci -> mostra".
    private var state = State.WAITING
    private var previous: FrameSignature? = null
    private var lastBitmap: Bitmap? = null
    private var shown: FrameSignature? = null
    private var shownBoxes: List<Rect> = emptyList()
    private var translatedPages = 0

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_SCREENSHOT) {
            // Mentre Mercurio cattura lo schermo Android blocca gli screenshot normali:
            // lo facciamo noi, con le traduzioni sopra, dopo che hai chiuso la tendina.
            if (projection != null && ::handler.isInitialized) {
                updateNotification("Chiudi la tendina: scatto tra 3 secondi")
                handler.postDelayed({ saveScreenshot() }, SCREENSHOT_DELAY_MS)
            }
            return START_NOT_STICKY
        }
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        startInForeground("Avvio…")
        if (projection != null) return START_NOT_STICKY

        val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, 0) ?: 0
        val data: Intent? = if (Build.VERSION.SDK_INT >= 33) {
            intent?.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent?.getParcelableExtra(EXTRA_RESULT_DATA)
        }
        val prefs = getSharedPreferences(MainActivity.PREFS, Context.MODE_PRIVATE)
        val apiKey = prefs.getString(MainActivity.KEY_API, "").orEmpty()
        val engine = prefs.getString(MainActivity.KEY_MODEL, PageTranslator.GOOGLE) ?: PageTranslator.GOOGLE
        if (data == null || (engine != PageTranslator.GOOGLE && apiKey.isBlank())) {
            stopSelf()
            return START_NOT_STICKY
        }

        worker = HandlerThread("traduttore").apply { start() }
        handler = Handler(worker.looper)
        windowManager = getSystemService(WindowManager::class.java)
        recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        japanese = TextRecognition.getClient(JapaneseTextRecognizerOptions.Builder().build())
        ocr = ComicOcr(recognizer, japanese)
        translator = PageTranslator.create(engine, apiKey)
        addOverlay()

        val manager = getSystemService(MediaProjectionManager::class.java)
        val mp = manager.getMediaProjection(resultCode, data)
        projection = mp
        mp.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                mainHandler.post { stopSelf() }
            }
        }, handler)

        screen = screenSize()
        val reader = newReader(screen)
        imageReader = reader
        virtualDisplay = mp.createVirtualDisplay(
            "traduttore-fumetti", screen.x, screen.y, resources.displayMetrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, reader.surface, null, handler,
        )
        running = true
        updateNotification("Attivo: apri il tuo fumetto")
        if (TextCleaner.words.isEmpty()) {
            handler.post {
                runCatching {
                    assets.open("parole_en.txt").bufferedReader().use { TextCleaner.loadWords(it.lineSequence()) }
                }
            }
        }
        handler.postDelayed(tick, INTERVAL_MS)
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        running = false
        if (::handler.isInitialized) {
            handler.removeCallbacksAndMessages(null)
            handler.post {
                virtualDisplay?.release()
                imageReader?.close()
                lastBitmap?.recycle()
                lastBitmap = null
                worker.quitSafely()
            }
        }
        projection?.stop()
        projection = null
        overlay?.let { runCatching { windowManager.removeView(it) } }
        overlay = null
        if (::recognizer.isInitialized) recognizer.close()
        if (::japanese.isInitialized) japanese.close()
        super.onDestroy()
    }

    // ---------- Ciclo principale (thread di lavoro) ----------

    private val tick = object : Runnable {
        override fun run() {
            try {
                step()
            } catch (e: Exception) {
                Log.e(TAG, "Errore", e)
                updateNotification("Errore: ${e.message ?: e.javaClass.simpleName}")
            }
            if (running) handler.postDelayed(this, INTERVAL_MS)
        }
    }

    private fun step() {
        followRotation()
        val fresh = grabFrame()
        if (fresh != null) {
            lastBitmap?.recycle()
            lastBitmap = fresh
        }
        val frame = lastBitmap ?: return
        // Nessun fotogramma nuovo = lo schermo non è cambiato.
        val sig = if (fresh != null) FrameSignature.of(fresh) else previous ?: FrameSignature.of(frame)

        when (state) {
            State.SHOWING -> {
                val before = shown ?: return
                if (fresh != null && sig.difference(before, maskRects()) > CHANGE_THRESHOLD) {
                    // Pagina cambiata o scorrimento: tolgo le traduzioni vecchie e aspetto che si fermi.
                    mainHandler.post { overlay?.clear() }
                    shownBoxes = emptyList()
                    state = State.WAITING
                    previous = sig
                }
            }
            State.WAITING -> {
                val prev = previous
                previous = sig
                if (prev != null && (fresh == null || sig.difference(prev) <= STABLE_THRESHOLD)) {
                    processPage(frame, sig)
                }
            }
        }
    }

    private fun processPage(frame: Bitmap, sig: FrameSignature) {
        val balloons = ocr.read(frame)

        state = State.SHOWING
        shown = sig
        shownBoxes = emptyList()
        if (balloons.isEmpty()) return

        val translations = try {
            updateNotification("Traduco ${balloons.size} balloon…")
            translator.translate(balloons.map { it.second })
        } catch (e: Exception) {
            Log.e(TAG, "Traduzione fallita", e)
            updateNotification("Traduzione non riuscita: ${e.message ?: e.javaClass.simpleName}")
            return
        }

        // Se nel frattempo la pagina è cambiata, non mostro traduzioni vecchie.
        val check = grabFrame()
        if (check != null) {
            lastBitmap?.recycle()
            lastBitmap = check
            val now = FrameSignature.of(check)
            if (now.difference(sig) > CHANGE_THRESHOLD) {
                state = State.WAITING
                previous = now
                return
            }
        }

        val items = balloons.zip(translations)
            .filter { it.second.isNotBlank() }
            .map { (b, t) -> OverlayView.Item(Rect(b.first), t) }
        shownBoxes = items.map { Rect(it.box) }
        mainHandler.post { overlay?.show(items) }
        translatedPages++
        updateNotification(
            "Pagine tradotte: $translatedPages" + (translator.usage()?.let { " · $it" } ?: "")
        )
    }

    /** Salva l'ultima schermata catturata (traduzioni comprese) in Immagini/Mercurio. */
    private fun saveScreenshot() {
        val bmp = lastBitmap?.copy(Bitmap.Config.ARGB_8888, false) ?: return
        try {
            val stamp = java.text.SimpleDateFormat("yyyyMMdd_HHmmss", java.util.Locale.ITALY).format(java.util.Date())
            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, "Mercurio_$stamp.png")
                put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                if (Build.VERSION.SDK_INT >= 29) {
                    put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Mercurio")
                }
            }
            val uri = contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                ?: throw IllegalStateException("impossibile creare il file")
            contentResolver.openOutputStream(uri)?.use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
                ?: throw IllegalStateException("impossibile scrivere il file")
            updateNotification("Screenshot salvato in Galleria (Immagini/Mercurio)")
        } catch (e: Exception) {
            Log.e(TAG, "Screenshot non riuscito", e)
            updateNotification("Screenshot non salvato: ${e.message ?: e.javaClass.simpleName}")
        } finally {
            bmp.recycle()
        }
    }

    /** Zone da ignorare nel confronto: i nostri riquadri, un po' allargati. */
    private fun maskRects(): List<Rect> {
        val drawn = overlay?.drawnRects.orEmpty()
        val margin = (screen.y * 0.02f).toInt()
        return (shownBoxes + drawn).map { Rect(it).apply { inset(-margin, -margin) } }
    }

    // ---------- Cattura ----------

    private fun newReader(size: Point): ImageReader =
        ImageReader.newInstance(size.x, size.y, PixelFormat.RGBA_8888, 2)

    private fun grabFrame(): Bitmap? {
        val image = imageReader?.acquireLatestImage() ?: return null
        try {
            val plane = image.planes[0]
            val pixelStride = plane.pixelStride
            val rowPadding = plane.rowStride - pixelStride * image.width
            val padded = Bitmap.createBitmap(
                image.width + rowPadding / pixelStride, image.height, Bitmap.Config.ARGB_8888,
            )
            padded.copyPixelsFromBuffer(plane.buffer)
            if (rowPadding == 0) return padded
            val cropped = Bitmap.createBitmap(padded, 0, 0, image.width, image.height)
            padded.recycle()
            return cropped
        } finally {
            image.close()
        }
    }

    /** Se il telefono ruota, adeguo la cattura alle nuove dimensioni. */
    private fun followRotation() {
        val now = screenSize()
        if (now == screen) return
        screen = now
        val old = imageReader
        val reader = newReader(now)
        virtualDisplay?.resize(now.x, now.y, resources.displayMetrics.densityDpi)
        virtualDisplay?.surface = reader.surface
        imageReader = reader
        old?.close()
        mainHandler.post { overlay?.clear() }
        shownBoxes = emptyList()
        previous = null
        state = State.WAITING
    }

    private fun screenSize(): Point {
        return if (Build.VERSION.SDK_INT >= 30) {
            val b = windowManager.currentWindowMetrics.bounds
            Point(b.width(), b.height())
        } else {
            val metrics = android.util.DisplayMetrics()
            @Suppress("DEPRECATION")
            windowManager.defaultDisplay.getRealMetrics(metrics)
            Point(metrics.widthPixels, metrics.heightPixels)
        }
    }

    // ---------- Overlay ----------

    private fun addOverlay() {
        val view = OverlayView(this)
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        )
        params.gravity = Gravity.TOP or Gravity.START
        // Da Android 12 i tocchi passano attraverso una sovrapposizione solo se è al massimo all'80% opaca:
        // così puoi continuare a scorrere e girare pagina con il dito.
        params.alpha = 0.8f
        if (Build.VERSION.SDK_INT >= 28) {
            params.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
        windowManager.addView(view, params)
        overlay = view
    }

    // ---------- Notifica ----------

    private fun buildNotification(text: String): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, "Traduzione attiva", NotificationManager.IMPORTANCE_LOW)
            )
        }
        val stop = PendingIntent.getService(
            this, 0, Intent(this, CaptureService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val shot = PendingIntent.getService(
            this, 2, Intent(this, CaptureService::class.java).setAction(ACTION_SCREENSHOT),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val open = PendingIntent.getActivity(
            this, 1, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
        )
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notifica)
            .setContentTitle("Mercurio")
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .addAction(Notification.Action.Builder(null, "Screenshot", shot).build())
            .addAction(Notification.Action.Builder(null, "Ferma", stop).build())
            .build()
    }

    private fun startInForeground(text: String) {
        val n = buildNotification(text)
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            startForeground(NOTIFICATION_ID, n)
        }
    }

    private fun updateNotification(text: String) {
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification(text))
    }

    companion object {
        private const val TAG = "TraduttoreFumetti"
        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_RESULT_DATA = "resultData"
        const val ACTION_STOP = "it.pask.traduttorefumetti.STOP"
        const val ACTION_SCREENSHOT = "it.pask.traduttorefumetti.SCREENSHOT"
        private const val SCREENSHOT_DELAY_MS = 3000L
        private const val CHANNEL = "traduzione"
        private const val NOTIFICATION_ID = 1

        /** Ogni quanto guardo lo schermo. */
        private const val INTERVAL_MS = 400L
        /** Differenza media di luminosità oltre la quale la pagina è "cambiata". */
        private const val CHANGE_THRESHOLD = 6
        /** Sotto questa differenza due fotogrammi di fila sono "fermi". */
        private const val STABLE_THRESHOLD = 3

        @Volatile
        var running = false
            private set

        /** Unisce le righe di un balloon, ricucendo le parole spezzate col trattino. */
        fun joinLines(lines: List<String>): String {
            val sb = StringBuilder()
            for (raw in lines) {
                val line = raw.trim()
                if (line.isEmpty()) continue
                if (sb.isNotEmpty()) {
                    if (sb.length > 1 && sb.last() == '-' && sb[sb.length - 2].isLetter()) {
                        sb.setLength(sb.length - 1)
                    } else {
                        sb.append(' ')
                    }
                }
                sb.append(line)
            }
            return sb.toString()
        }
    }
}
