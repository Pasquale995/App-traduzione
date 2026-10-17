package it.pask.traduttorefumetti

import android.content.Context
import android.graphics.PixelFormat
import android.graphics.Rect
import android.os.Build
import android.view.Gravity
import android.view.View
import android.view.WindowManager

/**
 * Riquadri oltre l'80% di opacità. Android 12+ blocca il tocco che attraversa una finestra
 * troppo opaca: per non bloccare tutto lo schermo, ogni traduzione ha una finestra piccola,
 * grande quanto il suo riquadro. Il dito blocca lo scorrimento solo se parte sopra una traduzione.
 */
class SolidBalloons(private val context: Context, private val windowManager: WindowManager) {

    private val views = ArrayList<Pair<OverlayView, WindowManager.LayoutParams>>()
    private val margin = (8 * context.resources.displayMetrics.density).toInt()
    private var visible = true

    @Volatile
    var drawnRects: List<Rect> = emptyList()
        private set

    fun show(items: List<OverlayView.Item>, alpha: Float, textScale: Float) {
        clear()
        val rects = ArrayList<Rect>()
        for (item in items) {
            if (item.text.isBlank()) continue
            val view = OverlayView(context).apply { this.textScale = textScale }
            val r = view.rectFor(item)
            rects += r
            val params = WindowManager.LayoutParams(
                r.width() + 2 * margin,
                r.height() + 2 * margin,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                    WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT,
            ).apply {
                gravity = Gravity.TOP or Gravity.START
                x = r.left - margin
                y = r.top - margin
                this.alpha = alpha
                if (Build.VERSION.SDK_INT >= 28) {
                    layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                }
            }
            // OverlayView disegna in coordinate dello schermo: basta che la finestra stia sopra il balloon.
            view.show(listOf(item))
            view.visibility = if (visible) View.VISIBLE else View.GONE
            runCatching { windowManager.addView(view, params) }.onSuccess { views += view to params }
        }
        drawnRects = rects
    }

    fun setAlpha(alpha: Float) {
        for ((view, params) in views) {
            params.alpha = alpha
            runCatching { windowManager.updateViewLayout(view, params) }
        }
    }

    fun setVisible(v: Boolean) {
        visible = v
        views.forEach { it.first.visibility = if (v) View.VISIBLE else View.GONE }
    }

    fun clear() {
        views.forEach { runCatching { windowManager.removeView(it.first) } }
        views.clear()
        drawnRects = emptyList()
    }
}
