package it.pask.traduttorefumetti

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.math.abs

/**
 * Due pallini galleggianti, trascinabili:
 * - Mercurio (icona): l'app è attiva; toccalo per fermarla.
 * - Fumetto: mostra o nasconde le traduzioni, per guardare la tavola pulita.
 */
@SuppressLint("ClickableViewAccessibility")
class ControlBubbles(
    private val context: Context,
    private val windowManager: WindowManager,
    private val onStop: () -> Unit,
    private val onToggle: (visible: Boolean) -> Unit,
) {
    private val density = context.resources.displayMetrics.density
    private var visible = true
    private val root = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
    private val params = WindowManager.LayoutParams(
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
        PixelFormat.TRANSLUCENT,
    ).apply {
        gravity = Gravity.TOP or Gravity.END
        x = (4 * density).toInt()
        y = (160 * density).toInt()
    }

    private val toggle = TextView(context).apply {
        text = "💬"
        textSize = 20f
        gravity = Gravity.CENTER
        background = circle(Color.WHITE)
    }

    /** Dove stanno i pallini sullo schermo (per non scambiarli per un cambio pagina). */
    @Volatile
    var screenRect: Rect = Rect()
        private set

    fun show() {
        val size = (46 * density).toInt()
        val gap = (8 * density).toInt()
        val power = ImageView(context).apply {
            setImageResource(R.mipmap.ic_launcher)
            background = circle(Color.WHITE)
            val p = (3 * density).toInt()
            setPadding(p, p, p, p)
        }
        root.addView(power, LinearLayout.LayoutParams(size, size))
        root.addView(toggle, LinearLayout.LayoutParams(size, size).apply { topMargin = gap })
        draggable(power) { onStop() }
        draggable(toggle) {
            visible = !visible
            toggle.alpha = if (visible) 1f else 0.45f
            toggle.text = if (visible) "💬" else "🙈"
            onToggle(visible)
        }
        root.elevation = 6 * density
        windowManager.addView(root, params)
        root.post { updateRect() }
    }

    fun remove() {
        runCatching { windowManager.removeView(root) }
    }

    private fun updateRect() {
        val loc = IntArray(2)
        root.getLocationOnScreen(loc)
        screenRect = Rect(loc[0], loc[1], loc[0] + root.width, loc[1] + root.height)
    }

    private fun circle(color: Int) = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(color)
        setStroke((2 * density).toInt(), Color.argb(220, 30, 30, 30))
    }

    /** Tocco breve = azione; trascinamento = sposta i pallini. */
    private fun draggable(view: View, onTap: () -> Unit) {
        val slop = ViewConfiguration.get(context).scaledTouchSlop
        var downX = 0f
        var downY = 0f
        var startX = 0
        var startY = 0
        var moved = false
        view.setOnTouchListener { _, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = e.rawX; downY = e.rawY
                    startX = params.x; startY = params.y
                    moved = false
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - downX
                    val dy = e.rawY - downY
                    if (moved || abs(dx) > slop || abs(dy) > slop) {
                        moved = true
                        // Gravità END: la x cresce verso sinistra.
                        params.x = (startX - dx).toInt().coerceAtLeast(0)
                        params.y = (startY + dy).toInt().coerceAtLeast(0)
                        runCatching { windowManager.updateViewLayout(root, params) }
                    }
                }
                MotionEvent.ACTION_UP -> {
                    if (!moved) onTap() else root.post { updateRect() }
                }
            }
            true
        }
    }
}
