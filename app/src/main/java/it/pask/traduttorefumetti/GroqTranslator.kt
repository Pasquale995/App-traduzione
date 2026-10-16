package it.pask.traduttorefumetti

import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Traduce con un LLM open source (Llama, Qwen...) tramite Groq, con chiave API gratuita
 * (console.groq.com, limiti giornalieri). Riceve solo il testo letto dall'OCR sul telefono:
 * una richiesta per pagina, formato compatto "N|testo", cache delle frasi già viste.
 * Se Groq non risponde o il limite gratuito è finito, usa il traduttore offline di Google.
 *
 * Con [pcAddress] parla invece con Ollama sul PC di casa (stesso protocollo, nessuna chiave):
 * Gemma gira sulla scheda video del PC e il telefono manda solo il testo in Wi-Fi.
 */
class GroqTranslator(private val apiKey: String, private val pcAddress: String? = null) : PageTranslator {

    private val baseUrl = pcAddress?.let { "http://${withPort(it)}/v1/" } ?: "https://api.groq.com/openai/v1/"
    private val name = if (pcAddress != null) "PC" else "Groq"

    private val fallback = GoogleOfflineTranslator()
    private var model: String? = null
    private var lastNote: String? = null
    private var tokens = 0L

    private val cache = object : LinkedHashMap<String, String>(256, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, String>?) = size > 3000
    }

    override fun usage(): String? = lastNote ?: model?.let { "$name ${it.substringAfterLast('/')} · token: $tokens" }

    override fun translate(texts: List<String>): List<String> {
        // I suoni già spiegati da TextCleaner ("WHOOSH (spostamento d'aria)") restano così.
        val todo = texts.filter { it !in cache && !isExplainedSound(it) }.distinct()
        if (todo.isNotEmpty()) {
            try {
                val result = request(todo)
                todo.forEachIndexed { i, src -> result[i + 1]?.let { cache[src] = it } }
                lastNote = null
            } catch (e: Exception) {
                Log.w("TraduttoreFumetti", "$name non disponibile, uso Google offline", e)
                lastNote = when {
                    e is LimitReached -> "limite $name raggiunto: uso Google offline"
                    pcAddress != null -> "il PC non risponde (acceso? stessa Wi-Fi?): uso Google offline"
                    else -> "Groq non risponde: uso Google offline"
                }
                val offline = fallback.translate(todo)
                return texts.map { t -> cache[t] ?: if (isExplainedSound(t)) t else offline[todo.indexOf(t)] }
            }
        }
        return texts.map { t -> cache[t] ?: if (isExplainedSound(t)) t else "" }
    }

    /** Una frase senza ripiego su Google: per il pulsante di prova (gli errori arrivano a chi chiama). */
    fun tryOne(text: String): String {
        val r = request(listOf(text))[1]
        return if (r.isNullOrBlank()) throw IllegalStateException("risposta vuota") else r
    }

    private fun isExplainedSound(t: String) = t.endsWith(")") && t.contains(" (") && t.substringBefore(" (").none { it.isLowerCase() }

    private fun request(texts: List<String>): Map<Int, String> {
        val m = model ?: chooseModel().also { model = it }
        val body = JSONObject()
            .put("model", m)
            .put("temperature", 0.3)
            .put("max_tokens", 4000)
            .put("messages", JSONArray()
                .put(JSONObject().put("role", "system").put("content", SYSTEM_PROMPT))
                .put(JSONObject().put("role", "user").put("content", texts.mapIndexed { i, t -> "${i + 1}|$t" }.joinToString("\n"))))
        val json = JSONObject(call("chat/completions", body.toString()))
        json.optJSONObject("usage")?.let { tokens += it.optLong("total_tokens") }
        val text = json.getJSONArray("choices").getJSONObject(0).getJSONObject("message").optString("content")
            .replace(Regex("(?s)<think>.*?</think>"), "")

        val out = HashMap<Int, String>()
        for (line in text.lines()) {
            val sep = line.indexOf('|')
            if (sep <= 0) continue
            val n = line.substring(0, sep).trim().trimStart('`').toIntOrNull() ?: continue
            out[n] = line.substring(sep + 1).trim()
        }
        return out
    }

    /** Sceglie il miglior modello disponibile sul conto gratuito (i nomi cambiano nel tempo). */
    private fun chooseModel(): String {
        val ids = JSONObject(call("models", null)).getJSONArray("data").let { a ->
            (0 until a.length()).map { a.getJSONObject(it).getString("id") }
        }
        if (pcAddress != null) {
            // Sul PC uso il Gemma scaricato con Ollama (se ce ne sono più, il primo).
            return ids.firstOrNull { it.contains("gemma") } ?: ids.firstOrNull()
                ?: throw IllegalStateException("Sul PC non c'è nessun modello: lancia 'ollama pull gemma3:4b'")
        }
        PREFERRED.firstOrNull { it in ids }?.let { return it }
        return ids.firstOrNull { id -> SKIP.none { id.contains(it) } }
            ?: throw IllegalStateException("Nessun modello Groq disponibile")
    }

    private fun call(path: String, body: String?): String {
        val conn = URL(baseUrl + path).openConnection() as HttpURLConnection
        conn.connectTimeout = if (pcAddress != null) 4_000 else 10_000
        // Sul PC la prima richiesta carica il modello nella scheda video: può volerci un po'.
        conn.readTimeout = if (pcAddress != null) 180_000 else 60_000
        if (apiKey.isNotBlank()) conn.setRequestProperty("Authorization", "Bearer $apiKey")
        if (body != null) {
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { it.write(body.toByteArray()) }
        }
        val code = conn.responseCode
        if (code == 429) throw LimitReached()
        val stream = if (code in 200..299) conn.inputStream else conn.errorStream
        val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
        if (code !in 200..299) {
            if (code == 401) throw IllegalStateException("Chiave $name non valida")
            throw IllegalStateException("$name ha risposto $code: ${text.take(200)}")
        }
        return text
    }

    private class LimitReached : Exception("Limite gratuito Groq raggiunto")

    companion object {
        /** "192.168.1.20" -> "192.168.1.20:11434" (la porta di Ollama), se manca la porta. */
        fun withPort(address: String): String {
            val a = address.trim().removePrefix("http://").removePrefix("https://").trimEnd('/')
            return if (a.substringAfterLast(']').contains(':')) a else "$a:11434"
        }

        private val PREFERRED = listOf(
            "llama-3.3-70b-versatile",
            "moonshotai/kimi-k2-instruct",
            "openai/gpt-oss-120b",
            "qwen/qwen3-32b",
            "llama-3.1-8b-instant",
        )
        private val SKIP = listOf("whisper", "guard", "tts", "playai", "compound", "orpheus", "prompt")

        private val SYSTEM_PROMPT = """
            You translate English or Japanese comic book and web novel text into Italian.
            Input: one text block per line as `N|text`, in reading order, all from the same page; use the other blocks as context.
            The text comes from OCR: it may be ALL CAPS, broken across lines, or contain small recognition errors. Fix those silently.
            Write natural, faithful Italian as a good Italian comics translator would: keep tone, slang, jokes and emphasis; adapt sound effects to Italian conventions; use normal sentence case.
            Output exactly one line per block as `N|translation` and nothing else. If a line is not real text (OCR noise, page numbers, logos, app buttons), output `N|`.
        """.trimIndent()
    }
}
