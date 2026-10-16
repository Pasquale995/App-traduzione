package it.pask.traduttorefumetti

import android.content.Context
import android.util.Log
import com.google.mediapipe.tasks.genai.llminference.LlmInference
import com.google.mediapipe.tasks.genai.llminference.LlmInferenceSession
import java.io.File

/**
 * Sperimentale: traduce con Gemma, il modello aperto di Google, che gira tutto sul telefono
 * (gratis, offline, nessun testo esce dal telefono). Il file del modello (.task) si scarica
 * a parte e si sceglie dalle impostazioni; Mercurio lo copia in [modelFile].
 * Se il modello manca o non parte, usa il traduttore offline di Google.
 */
class GemmaTranslator(
    private val context: Context,
    private val status: (String) -> Unit = {},
) : PageTranslator {

    private val fallback = GoogleOfflineTranslator()
    private var llm: LlmInference? = null
    private var failed = false
    private var lastNote: String? = null
    private var pages = 0
    private var lastMs = 0L
    private var loadNote: String? = null

    private val cache = object : LinkedHashMap<String, String>(256, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, String>?) = size > 3000
    }

    override fun usage(): String? = lastNote ?: if (pages > 0) "Gemma sul telefono · ultima pagina ${lastMs / 1000.0}s" else null

    override fun translate(texts: List<String>): List<String> {
        val todo = texts.filter { it !in cache && !isExplainedSound(it) }.distinct()
        if (todo.isNotEmpty()) {
            val model = engine()
            if (model == null) return offline(texts, todo)
            try {
                val start = System.currentTimeMillis()
                val result = request(model, todo)
                lastMs = System.currentTimeMillis() - start
                pages++
                todo.forEachIndexed { i, src -> result[i + 1]?.takeIf { it.isNotBlank() }?.let { cache[src] = it } }
                lastNote = null
                // Le righe che Gemma ha saltato le traduco con Google.
                val missing = todo.filter { it !in cache }
                if (missing.isNotEmpty()) {
                    fallback.translate(missing).forEachIndexed { i, t -> cache[missing[i]] = t }
                }
            } catch (e: Throwable) {
                Log.w("TraduttoreFumetti", "Gemma non ha risposto, uso Google offline", e)
                lastNote = "Gemma non ha risposto (${short(e)}): uso Google offline"
                return offline(texts, todo)
            }
        }
        return texts.map { t -> cache[t] ?: if (isExplainedSound(t)) t else "" }
    }

    private fun offline(texts: List<String>, todo: List<String>): List<String> {
        val out = fallback.translate(todo)
        return texts.map { t -> cache[t] ?: if (isExplainedSound(t)) t else out[todo.indexOf(t)] }
    }

    /** Carica il modello la prima volta (qualche secondo); prova prima la GPU, poi la CPU. */
    private fun engine(): LlmInference? {
        llm?.let { return it }
        if (failed) return null
        val file = modelFile(context)
        if (!file.exists()) {
            failed = true
            lastNote = "manca il modello Gemma (impostazioni): uso Google offline"
            return null
        }
        status("Carico Gemma (${file.length() / 1_000_000} MB): la prima volta può volerci un minuto…")
        val errors = ArrayList<String>()
        for (backend in listOf(LlmInference.Backend.GPU, LlmInference.Backend.CPU)) {
            try {
                val start = System.currentTimeMillis()
                val options = LlmInference.LlmInferenceOptions.builder()
                    .setModelPath(file.absolutePath)
                    .setMaxTokens(MAX_TOKENS)
                    .setPreferredBackend(backend)
                    .build()
                return LlmInference.createFromOptions(context, options).also {
                    llm = it
                    loadNote = "Gemma caricato su $backend in ${(System.currentTimeMillis() - start) / 1000}s"
                    status(loadNote!!)
                }
            } catch (e: Throwable) {
                Log.w("TraduttoreFumetti", "Gemma non parte con $backend", e)
                errors += "$backend: ${short(e)}"
            }
        }
        failed = true
        lastNote = "Gemma non parte (${errors.joinToString("; ")}): uso Google offline"
        return null
    }

    private fun request(model: LlmInference, texts: List<String>): Map<Int, String> {
        val options = LlmInferenceSession.LlmInferenceSessionOptions.builder()
            .setTemperature(0.2f)
            .setTopK(20)
            .build()
        // Una sessione nuova per pagina: Gemma non si porta dietro le pagine precedenti.
        val session = LlmInferenceSession.createFromOptions(model, options)
        val text = try {
            session.addQueryChunk(PROMPT + texts.mapIndexed { i, t -> "${i + 1}|$t" }.joinToString("\n"))
            session.generateResponse()
        } finally {
            session.close()
        }
        val out = HashMap<Int, String>()
        for (line in text.lines()) {
            val sep = line.indexOf('|')
            if (sep <= 0) continue
            val n = line.substring(0, sep).trim().trimStart('`', '*').toIntOrNull() ?: continue
            out[n] = line.substring(sep + 1).trim()
        }
        return out
    }

    override fun close() {
        runCatching { llm?.close() }
        llm = null
    }

    private fun isExplainedSound(t: String) = t.endsWith(")") && t.contains(" (") && t.substringBefore(" (").none { it.isLowerCase() }

    companion object {
        private const val MAX_TOKENS = 2048

        private fun short(e: Throwable) = (e.message ?: e.javaClass.simpleName).lineSequence().first().take(160)

        /** Prova dalle impostazioni: carica il modello e traduce una frase, riportando tempi o errore. */
        fun selfTest(context: Context): String {
            val t = GemmaTranslator(context)
            return try {
                val model = t.engine() ?: return t.lastNote ?: "Gemma non parte"
                val start = System.currentTimeMillis()
                val out = t.request(model, listOf(SAMPLE))
                val secs = (System.currentTimeMillis() - start) / 1000.0
                val text = out[1]
                if (text.isNullOrBlank()) "${t.loadNote}. Ha risposto in modo strano in ${secs}s"
                else "${t.loadNote}. Frase tradotta in ${secs}s:\n«$text»"
            } catch (e: Throwable) {
                "Errore: ${short(e)}"
            } finally {
                t.close()
            }
        }

        private const val SAMPLE = "DAMN... TOP RANKERS HAVE CONNECTIONS WITH GOVERNMENTS TOO."

        fun modelFile(context: Context) = File(context.filesDir, "gemma.task")

        private val PROMPT = """
            Translate this English or Japanese comic book text into natural Italian.
            Input: one text block per line as `N|text`, all from the same page. The text comes from OCR and may be ALL CAPS or slightly wrong: fix it silently.
            Keep tone, slang and jokes. Use normal sentence case.
            Answer with exactly one line per block as `N|translation` and nothing else.

        """.trimIndent() + "\n"
    }
}
