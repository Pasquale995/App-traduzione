package it.pask.traduttorefumetti

import com.anthropic.client.AnthropicClient
import com.anthropic.client.okhttp.AnthropicOkHttpClient
import com.anthropic.core.JsonValue
import com.anthropic.models.beta.messages.BetaOutputConfig
import com.anthropic.models.beta.messages.BetaStopReason
import com.anthropic.models.beta.messages.MessageCreateParams

/**
 * Traduce i balloon EN -> IT con Claude (a pagamento, serve una chiave API).
 * Per spendere pochi token: una sola richiesta per pagina, solo le frasi mai viste
 * (cache in memoria), formato compatto "N|testo" in entrata e in uscita.
 */
class ClaudeTranslator(apiKey: String, private val model: String) : PageTranslator {

    private val client: AnthropicClient = AnthropicOkHttpClient.builder()
        .apiKey(apiKey)
        .build()

    private val cache = object : LinkedHashMap<String, String>(256, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, String>?) = size > 3000
    }

    private var inputTokens = 0L
    private var outputTokens = 0L

    override fun usage() = "token usati: $inputTokens in / $outputTokens out"

    override fun translate(texts: List<String>): List<String> {
        val missing = synchronized(cache) { texts.filter { it !in cache }.distinct() }
        if (missing.isNotEmpty()) {
            val result = requestTranslations(missing)
            synchronized(cache) {
                missing.forEachIndexed { i, src -> result[i + 1]?.let { cache[src] = it } }
            }
        }
        return synchronized(cache) { texts.map { cache[it] ?: "" } }
    }

    private fun requestTranslations(texts: List<String>): Map<Int, String> {
        val input = texts.mapIndexed { i, t -> "${i + 1}|$t" }.joinToString("\n")

        val builder = MessageCreateParams.builder()
            .model(model)
            .maxTokens(4000L)
            .system(SYSTEM_PROMPT)
            .outputConfig(BetaOutputConfig.builder().effort(BetaOutputConfig.Effort.LOW).build())
            .addUserMessage(input)

        if (model.startsWith("claude-opus")) {
            // Se un filtro di sicurezza rifiuta la richiesta, il server riprova da solo su un altro modello.
            builder.addBeta("server-side-fallback-2026-07-01")
            builder.putAdditionalBodyProperty("fallbacks", JsonValue.from("default"))
        }

        val message = client.beta().messages().create(builder.build())
        inputTokens += message.usage().inputTokens()
        outputTokens += message.usage().outputTokens()

        if (message.stopReason().orElse(null) == BetaStopReason.REFUSAL) {
            throw IllegalStateException("Claude ha rifiutato di tradurre questa pagina")
        }

        val text = message.content()
            .mapNotNull { block -> block.text().orElse(null)?.text() }
            .joinToString("\n")

        val out = HashMap<Int, String>()
        for (line in text.lines()) {
            val sep = line.indexOf('|')
            if (sep <= 0) continue
            val n = line.substring(0, sep).trim().toIntOrNull() ?: continue
            out[n] = line.substring(sep + 1).trim()
        }
        return out
    }

    companion object {
        private val SYSTEM_PROMPT = """
            You translate English or Japanese comic book speech balloons into Italian.
            Input: one balloon per line as `N|text`, in reading order, all from the same page; use the other balloons as context.
            The text comes from OCR: it may be ALL CAPS, broken across lines, or contain small recognition errors. Fix those silently.
            Write natural, faithful Italian as a good Italian comics translator would: keep tone, slang, jokes and emphasis; adapt sound effects to Italian conventions; use normal sentence case.
            Output exactly one line per balloon as `N|translation` and nothing else. If a line is not real text (OCR noise, page numbers, logos), output `N|`.
        """.trimIndent()
    }
}
