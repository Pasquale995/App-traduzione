package it.pask.traduttorefumetti

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.ViewGroup
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast

class MainActivity : Activity() {

    private lateinit var keyField: EditText
    private lateinit var modelGroup: RadioGroup
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val pad = (16 * resources.displayMetrics.density).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
        }
        fun label(text: String) = TextView(this).apply {
            this.text = text
            textSize = 15f
            setPadding(0, pad / 2, 0, pad / 4)
        }

        root.addView(label(
            "Legge i balloon in inglese o giapponese sullo schermo e ci scrive sopra la traduzione italiana. " +
                "Avvialo, poi apri la tua app di fumetti."
        ))

        root.addView(label("Traduttore"))
        val engines = listOf(
            PageTranslator.GOOGLE to "Google offline (gratis, funziona anche senza internet)",
            PageTranslator.GROQ to "LLM open source via Groq (gratis con chiave, traduzione più naturale)",
            PageTranslator.CLAUDE_HAIKU to "Claude Haiku 5.5 (a pagamento, serve la chiave API)",
            PageTranslator.CLAUDE_OPUS to "Claude Opus 5.5 (a pagamento, traduzione migliore)",
        )
        val saved = prefs.getString(KEY_MODEL, PageTranslator.GOOGLE)
        modelGroup = RadioGroup(this).apply {
            engines.forEachIndexed { i, (engine, text) ->
                addView(RadioButton(this@MainActivity).apply {
                    id = i + 1
                    this.text = text
                    tag = engine
                })
                if (engine == saved) check(i + 1)
            }
            if (checkedRadioButtonId == -1) check(1)
        }
        root.addView(modelGroup)

        root.addView(label("Chiave API: gratuita da console.groq.com per Groq, oppure Anthropic per Claude"))
        keyField = EditText(this).apply {
            hint = "gsk_… oppure sk-ant-…"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            setText(prefs.getString(KEY_API, ""))
        }
        root.addView(keyField)

        // Aspetto dei riquadri: si applica subito, anche con la traduzione già attiva.
        fun slider(title: String, key: String, def: Int, min: Int, max: Int, unit: String) {
            val lbl = label("")
            fun show(v: Int) { lbl.text = "$title: $v$unit" }
            val current = prefs.getInt(key, def).coerceIn(min, max)
            show(current)
            root.addView(lbl)
            root.addView(SeekBar(this).apply {
                this.max = max - min
                progress = current - min
                setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                    override fun onProgressChanged(bar: SeekBar, p: Int, fromUser: Boolean) {
                        show(p + min)
                        if (fromUser) prefs.edit().putInt(key, p + min).apply()
                    }
                    override fun onStartTrackingTouch(bar: SeekBar) {}
                    override fun onStopTrackingTouch(bar: SeekBar) {}
                })
            })
        }
        slider("Dimensione del testo", KEY_TEXT_SIZE, 100, 60, 160, "%")
        slider("Opacità dei riquadri", KEY_OPACITY, 80, 20, 80, "% (massimo 80: oltre, Android blocca il dito)")
        root.addView(CheckBox(this).apply {
            text = "Mostra i pallini: Mercurio (tocca per fermare) e fumetto (mostra/nascondi traduzioni)"
            isChecked = prefs.getBoolean(KEY_BUBBLES, true)
            setOnCheckedChangeListener { _, on -> prefs.edit().putBoolean(KEY_BUBBLES, on).apply() }
        })

        root.addView(Button(this).apply {
            text = "1. Consenti di disegnare sopra le altre app"
            setOnClickListener {
                startActivity(
                    Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))
                )
            }
        })
        root.addView(Button(this).apply {
            text = "2. Avvia traduzione"
            setOnClickListener { start() }
        })
        root.addView(Button(this).apply {
            text = "Ferma"
            setOnClickListener {
                startService(Intent(this@MainActivity, CaptureService::class.java).setAction(CaptureService.ACTION_STOP))
                refreshStatus()
            }
        })
        status = label("")
        root.addView(status)

        setContentView(ScrollView(this).apply {
            addView(root, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        })

        if (Build.VERSION.SDK_INT >= 33) {
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 0)
        }
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
    }

    private fun refreshStatus() {
        val overlayOk = Settings.canDrawOverlays(this)
        status.text = buildString {
            append(if (overlayOk) "✓ Permesso sovrapposizione concesso\n" else "✗ Manca il permesso sovrapposizione (pulsante 1)\n")
            append(if (CaptureService.running) "● Traduzione attiva" else "○ Traduzione ferma")
        }
    }

    private fun start() {
        val key = keyField.text.toString().trim()
        val engine = modelGroup.findViewById<RadioButton>(modelGroup.checkedRadioButtonId)?.tag as? String
            ?: PageTranslator.GOOGLE
        if (engine != PageTranslator.GOOGLE && key.isEmpty()) {
            Toast.makeText(this, "Per questo traduttore serve la chiave API", Toast.LENGTH_SHORT).show()
            return
        }
        if (!Settings.canDrawOverlays(this)) {
            Toast.makeText(this, "Prima concedi il permesso con il pulsante 1", Toast.LENGTH_LONG).show()
            return
        }
        getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_API, key)
            .putString(KEY_MODEL, engine)
            .apply()
        val manager = getSystemService(MediaProjectionManager::class.java)
        @Suppress("DEPRECATION")
        startActivityForResult(manager.createScreenCaptureIntent(), REQUEST_CAPTURE)
    }

    @Deprecated("Activity semplice senza AndroidX")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_CAPTURE) return
        if (resultCode != RESULT_OK || data == null) {
            Toast.makeText(this, "Serve il permesso di cattura schermo", Toast.LENGTH_SHORT).show()
            return
        }
        startForegroundService(
            Intent(this, CaptureService::class.java)
                .putExtra(CaptureService.EXTRA_RESULT_CODE, resultCode)
                .putExtra(CaptureService.EXTRA_RESULT_DATA, data)
        )
        Toast.makeText(this, "Attivo: ora apri il fumetto", Toast.LENGTH_LONG).show()
        moveTaskToBack(true)
    }

    companion object {
        const val PREFS = "impostazioni"
        const val KEY_API = "api_key"
        const val KEY_MODEL = "model"
        const val KEY_TEXT_SIZE = "text_size"
        const val KEY_OPACITY = "opacity"
        const val KEY_BUBBLES = "bubbles"
        private const val REQUEST_CAPTURE = 42
    }
}
