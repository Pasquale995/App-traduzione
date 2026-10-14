package it.pask.traduttorefumetti

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.graphics.Rect
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognizer
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Legge le scritte di una pagina di fumetto con ML Kit, sul telefono, in più passate:
 * 1. immagine normale;
 * 2. immagine in bianco e nero molto contrastata (aiuta con retini e sfondi disegnati);
 * 3. i pezzi letti male vengono riletti ingranditi (aiuta con lettering a mano e suoni).
 * Poi unisce le scritte vicine (es. "STAY" + "AWAYYY!!!") in un solo testo.
 * Infine una passata con il lettore giapponese trova kanji e kana.
 */
class ComicOcr(private val recognizer: TextRecognizer, private val japanese: TextRecognizer?) {

    data class Piece(val box: Rect, val text: String, val confidence: Float, val lineHeight: Int)

    fun read(frame: Bitmap): List<Pair<Rect, String>> {
        val pieces = ArrayList(recognize(frame, 1f, 0, 0))

        val contrast = highContrast(frame, 1f)
        mergeInto(pieces, recognize(contrast, 1f, 0, 0))
        contrast.recycle()

        // Rileggo ingranditi i pezzi più incerti (al massimo alcuni, per non rallentare).
        val doubtful = pieces.filter { it.confidence < REFINE_BELOW || TextCleaner.looksBroken(it.text) }
            .sortedBy { score(it) }.take(MAX_REFINES).toSet()
        val refined = pieces.map { p -> if (p in doubtful) refine(frame, p) ?: p else p }
        var latin = group(dedupe(refined))
            .map { it.box to TextCleaner.clean(it.text) }
            .filter { (_, t) -> t.count { it.isLetter() } >= 2 }

        val jp = japanese ?: return latin
        val kanji = recognize(frame, 1f, 0, 0, jp, joinWithSpaces = false)
            .filter { TextCleaner.isJapanese(it.text) }
        if (kanji.isEmpty()) return latin
        // Dove c'è giapponese, quello che ha letto il lettore latino è spazzatura.
        latin = latin.filter { (box, _) -> kanji.none { overlap(it.box, box) > 0.4f } }
        return latin + kanji.map { it.box to it.text.replace(" ", "") }
    }

    // ---------- Riconoscimento ----------

    /** Esegue ML Kit e riporta i riquadri nelle coordinate dello schermo. */
    private fun recognize(
        bmp: Bitmap, scale: Float, offX: Int, offY: Int,
        reader: TextRecognizer = recognizer, joinWithSpaces: Boolean = true,
    ): List<Piece> {
        val result = Tasks.await(reader.process(InputImage.fromBitmap(bmp, 0)))
        return result.textBlocks.mapNotNull { block -> toPiece(block, scale, offX, offY, joinWithSpaces) }
    }

    private fun toPiece(block: Text.TextBlock, scale: Float, offX: Int, offY: Int, spaces: Boolean): Piece? {
        val b = block.boundingBox ?: return null
        val lines = block.lines.filter { it.text.isNotBlank() }
        if (lines.isEmpty()) return null
        val box = Rect(
            offX + (b.left / scale).roundToInt(), offY + (b.top / scale).roundToInt(),
            offX + (b.right / scale).roundToInt(), offY + (b.bottom / scale).roundToInt(),
        )
        val conf = lines.map { it.confidence }.average().toFloat()
        val lineH = max(1, min(box.height(), box.width()) / lines.size)
        val text = if (spaces) CaptureService.joinLines(lines.map { it.text }) else lines.joinToString("") { it.text }
        return Piece(box, text, conf, lineH)
    }

    /** Aggiunge i pezzi trovati solo nella seconda passata, o sostituisce quelli letti peggio. */
    private fun mergeInto(pieces: MutableList<Piece>, extra: List<Piece>) {
        for (e in extra) {
            val i = pieces.indexOfFirst { overlap(it.box, e.box) > 0.5f }
            if (i < 0) {
                if (e.confidence >= MIN_NEW_CONFIDENCE) pieces += e
            } else if (score(e) > score(pieces[i]) + 0.05f) {
                pieces[i] = e
            }
        }
    }

    /** Rilegge un pezzo incerto ritagliandolo con un po' di margine e ingrandendolo. */
    private fun refine(frame: Bitmap, p: Piece): Piece? {
        val mx = max(p.lineHeight, p.box.width() / 4)
        val my = p.lineHeight
        val crop = Rect(p.box).apply { inset(-mx, -my) }
        if (!crop.intersect(0, 0, frame.width, frame.height) || crop.width() < 8 || crop.height() < 8) return null

        var scale = (TARGET_LINE_PX / p.lineHeight.toFloat()).coerceIn(1.5f, 3f)
        val maxScale = kotlin.math.sqrt(MAX_REFINE_PIXELS / (crop.width().toFloat() * crop.height()))
        scale = min(scale, maxScale)
        if (scale < 1.2f) return null

        val cut = Bitmap.createBitmap(frame, crop.left, crop.top, crop.width(), crop.height())
        val big = highContrast(cut, scale)
        cut.recycle()
        val found = try {
            recognize(big, scale, crop.left, crop.top)
        } finally {
            big.recycle()
        }
        // Tengo solo ciò che sta attorno al pezzo originale (il ritaglio può toccare balloon vicini).
        val near = Rect(p.box).apply { inset(-p.lineHeight, -p.lineHeight) }
        val keep = found.filter { near.contains(it.box.centerX(), it.box.centerY()) }
            .sortedBy { it.box.top }
        if (keep.isEmpty()) return null
        val box = Rect(keep[0].box)
        keep.forEach { box.union(it.box) }
        val merged = Piece(
            box,
            keep.joinToString(" ") { it.text },
            keep.map { it.confidence }.average().toFloat(),
            keep.map { it.lineHeight }.average().roundToInt(),
        )
        return if (score(merged) > score(p)) merged else null
    }

    /** Qualità di una lettura: fiducia di ML Kit, penalizzata se il testo sembra spazzatura. */
    private fun score(p: Piece): Float =
        p.confidence - (if (TextCleaner.looksBroken(p.text)) 0.2f else 0f)

    // ---------- Pulizia e raggruppamento ----------

    /** Toglie i doppioni: se un pezzo è quasi tutto dentro uno migliore, lo scarto. */
    private fun dedupe(pieces: List<Piece>): List<Piece> {
        val kept = ArrayList<Piece>()
        for (p in pieces.sortedByDescending { score(it) }) {
            if (kept.none { overlap(it.box, p.box) > 0.6f }) kept += p
        }
        return kept
    }

    /** Unisce le scritte una sopra l'altra e vicine: di solito sono lo stesso balloon. */
    private fun group(pieces: List<Piece>): List<Piece> {
        val parent = IntArray(pieces.size) { it }
        fun find(i: Int): Int {
            var x = i
            while (parent[x] != x) x = parent[x]
            return x
        }
        for (i in pieces.indices) for (j in i + 1 until pieces.size) {
            if (close(pieces[i], pieces[j])) parent[find(i)] = find(j)
        }
        return pieces.indices.groupBy { find(it) }.values.map { idx ->
            val members = idx.map { pieces[it] }.sortedBy { it.box.top }
            val box = Rect(members[0].box)
            members.forEach { box.union(it.box) }
            Piece(
                box,
                members.joinToString(" ") { it.text },
                members.map { it.confidence }.average().toFloat(),
                members.map { it.lineHeight }.average().roundToInt(),
            )
        }
    }

    private fun close(a: Piece, b: Piece): Boolean {
        val lh = min(a.lineHeight, b.lineHeight)
        val vGap = max(a.box.top, b.box.top) - min(a.box.bottom, b.box.bottom)
        val hOverlap = min(a.box.right, b.box.right) - max(a.box.left, b.box.left)
        val narrow = min(a.box.width(), b.box.width())
        // Righe simili come altezza, una sotto l'altra, che si sovrappongono in orizzontale.
        val similar = max(a.lineHeight, b.lineHeight) <= 2.5f * lh
        return similar && vGap < 0.9f * lh && hOverlap > 0.3f * narrow
    }

    companion object {
        private const val REFINE_BELOW = 0.8f
        private const val MAX_REFINES = 10
        private const val MIN_NEW_CONFIDENCE = 0.5f
        private const val TARGET_LINE_PX = 70f
        private const val MAX_REFINE_PIXELS = 2_500_000f

        /** Quanto del rettangolo più piccolo è coperto dall'altro (0..1). */
        fun overlap(a: Rect, b: Rect): Float {
            val r = Rect()
            if (!r.setIntersect(a, b)) return 0f
            val small = min(a.width() * a.height(), b.width() * b.height()).coerceAtLeast(1)
            return r.width() * r.height() / small.toFloat()
        }

        /** Scala di grigi con contrasto forte, eventualmente ingrandita. */
        fun highContrast(src: Bitmap, scale: Float): Bitmap {
            val w = (src.width * scale).roundToInt()
            val h = (src.height * scale).roundToInt()
            val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            val c = CONTRAST
            val t = 128f * (1 - c)
            val m = ColorMatrix(
                floatArrayOf(
                    0.299f * c, 0.587f * c, 0.114f * c, 0f, t,
                    0.299f * c, 0.587f * c, 0.114f * c, 0f, t,
                    0.299f * c, 0.587f * c, 0.114f * c, 0f, t,
                    0f, 0f, 0f, 1f, 0f,
                )
            )
            val paint = Paint(Paint.FILTER_BITMAP_FLAG).apply { colorFilter = ColorMatrixColorFilter(m) }
            Canvas(out).apply {
                drawColor(android.graphics.Color.WHITE)
                scale(scale, scale)
                drawBitmap(src, 0f, 0f, paint)
            }
            return out
        }

        private const val CONTRAST = 1.8f
    }
}
