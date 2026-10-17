package it.pask.traduttorefumetti

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.view.View

/** Disegna la traduzione sopra ogni balloon, nelle coordinate dello schermo. */
class OverlayView(context: Context) : View(context) {

    data class Item(val box: Rect, val text: String)

    private var items: List<Item> = emptyList()

    /** Dimensione del testo scelta nelle impostazioni (1 = normale). */
    var textScale = 1f
        set(value) {
            field = value.coerceIn(0.5f, 2f)
            invalidate()
        }

    /** Riquadri effettivamente disegnati (coordinate schermo), letti dal servizio. */
    @Volatile
    var drawnRects: List<Rect> = emptyList()
        private set
    private val location = IntArray(2)
    private val density = resources.displayMetrics.density

    private val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    private val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(200, 30, 30, 30)
        style = Paint.Style.STROKE
        strokeWidth = 1.5f * density
    }
    private val textPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.BLACK
        isFakeBoldText = true
    }

    fun show(newItems: List<Item>) {
        items = newItems
        invalidate()
    }

    fun clear() {
        if (items.isEmpty()) return
        items = emptyList()
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        if (items.isEmpty()) {
            drawnRects = emptyList()
            return
        }
        val drawn = ArrayList<Rect>()
        // La finestra potrebbe non partire esattamente da (0,0) dello schermo.
        getLocationOnScreen(location)
        canvas.save()
        canvas.translate(-location[0].toFloat(), -location[1].toFloat())
        val pad = 4 * density
        for (item in items) {
            if (item.text.isBlank()) continue
            val (box, layout) = place(item)
            drawn.add(Rect(box.left.toInt(), box.top.toInt(), box.right.toInt(), box.bottom.toInt()))
            val r = 8 * density
            canvas.drawRoundRect(box, r, r, bgPaint)
            canvas.drawRoundRect(box, r, r, borderPaint)
            canvas.save()
            canvas.translate(box.left + pad, box.top + (box.height() - layout.height) / 2f)
            layout.draw(canvas)
            canvas.restore()
        }
        canvas.restore()
        drawnRects = drawn
    }

    /** Riquadro (coordinate schermo) e testo impaginato di un balloon. */
    private fun place(item: Item): Pair<RectF, StaticLayout> {
        val pad = 4 * density
        val box = RectF(item.box).apply { inset(-pad, -pad) }
        val innerWidth = (box.width() - 2 * pad).toInt().coerceAtLeast(20)
        val layout = fitText(item.text, innerWidth, box.height() - 2 * pad)
        // Se il testo italiano è più lungo, il riquadro si allunga verso il basso.
        val neededHeight = layout.height + 2 * pad
        if (neededHeight > box.height()) box.bottom = box.top + neededHeight
        return box to layout
    }

    /** Dove verrà disegnato un balloon, per creargli una finestra su misura. */
    fun rectFor(item: Item): Rect = place(item).first.let { Rect(it.left.toInt(), it.top.toInt(), it.right.toInt() + 1, it.bottom.toInt() + 1) }

    /** Sceglie la dimensione del testo più grande che entra nel balloon. */
    private fun fitText(text: String, width: Int, maxHeight: Float): StaticLayout {
        var size = 18f * density * textScale
        val min = 9f * density * textScale
        while (true) {
            textPaint.textSize = size
            val layout = StaticLayout.Builder.obtain(text, 0, text.length, textPaint, width)
                .setAlignment(Layout.Alignment.ALIGN_CENTER)
                .setIncludePad(false)
                .build()
            if (layout.height <= maxHeight || size <= min) return layout
            size -= 1f * density
        }
    }
}
