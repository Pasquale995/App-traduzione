package it.pask.traduttorefumetti

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Rect
import kotlin.math.abs

/**
 * "Impronta" molto piccola di un fotogramma (griglia di luminosità),
 * per capire se la pagina è cambiata senza rifare l'OCR ogni volta.
 */
class FrameSignature private constructor(
    private val cells: IntArray,
    private val frameWidth: Int,
    private val frameHeight: Int,
) {

    /**
     * Differenza media (0-255) con un'altra impronta, ignorando le celle coperte da [mask]
     * (i riquadri della nostra traduzione, che altrimenti sembrerebbero un cambio pagina).
     */
    fun difference(other: FrameSignature, mask: List<Rect> = emptyList()): Int {
        if (other.cells.size != cells.size) return 255
        val cellW = frameWidth.toFloat() / COLS
        val cellH = frameHeight.toFloat() / ROWS
        var sum = 0L
        var count = 0
        for (row in 0 until ROWS) {
            for (col in 0 until COLS) {
                if (mask.isNotEmpty()) {
                    val l = (col * cellW).toInt()
                    val t = (row * cellH).toInt()
                    val cell = Rect(l, t, (l + cellW).toInt() + 1, (t + cellH).toInt() + 1)
                    if (mask.any { Rect.intersects(it, cell) }) continue
                }
                val i = row * COLS + col
                sum += abs(cells[i] - other.cells[i])
                count++
            }
        }
        // Se la traduzione copre quasi tutto lo schermo non possiamo giudicare: diciamo "uguale".
        if (count < cells.size / 10) return 0
        return (sum / count).toInt()
    }

    companion object {
        private const val COLS = 24
        private const val ROWS = 48

        fun of(bitmap: Bitmap): FrameSignature {
            val small = Bitmap.createScaledBitmap(bitmap, COLS, ROWS, true)
            val pixels = IntArray(COLS * ROWS)
            small.getPixels(pixels, 0, COLS, 0, 0, COLS, ROWS)
            if (small !== bitmap) small.recycle()
            val cells = IntArray(pixels.size) { i ->
                val p = pixels[i]
                (Color.red(p) * 299 + Color.green(p) * 587 + Color.blue(p) * 114) / 1000
            }
            return FrameSignature(cells, bitmap.width, bitmap.height)
        }
    }
}
