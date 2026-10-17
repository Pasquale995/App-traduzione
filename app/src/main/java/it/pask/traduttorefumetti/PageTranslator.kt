package it.pask.traduttorefumetti

import com.google.android.gms.tasks.Tasks
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.TranslatorOptions

/** Traduce i testi di una pagina, uno per balloon, nello stesso ordine. */
interface PageTranslator {
    fun translate(texts: List<String>): List<String>

    /** Riga da mostrare nella notifica (token usati), o null se non serve. */
    fun usage(): String? = null

    /** Libera le risorse (es. il modello Gemma in memoria). */
    fun close() {}

    companion object {
        const val GOOGLE = "google-offline"
        const val GEMMA = "gemma-telefono"
        const val GROQ = "groq"
        const val PC = "pc-ollama"

        fun needsKey(engine: String) = engine == GROQ

        fun create(
            engine: String, apiKey: String, context: android.content.Context, status: (String) -> Unit = {},
        ): PageTranslator =
            when (engine) {
                GOOGLE -> GoogleOfflineTranslator()
                GEMMA -> GemmaTranslator(context, status)
                GROQ -> GroqTranslator(apiKey)
                PC -> context.getSharedPreferences(MainActivity.PREFS, android.content.Context.MODE_PRIVATE).let {
                    GroqTranslator(
                        "",
                        it.getString(MainActivity.KEY_PC_ADDRESS, "").orEmpty(),
                        it.getString(MainActivity.KEY_PC_MODEL, ""),
                    )
                }
                // Anche le vecchie scelte (Claude, tolto dalla 0.21) tornano a Google offline.
                else -> GoogleOfflineTranslator()
            }
    }
}

/**
 * Traduttore gratuito di Google che gira sul telefono, senza internet
 * (la prima volta scarica il modello inglese-italiano, circa 30 MB, e il giapponese-italiano
 * solo quando incontra del giapponese).
 */
class GoogleOfflineTranslator : PageTranslator {

    private val client = clientFrom(TranslateLanguage.ENGLISH)
    private val japanese = clientFrom(TranslateLanguage.JAPANESE)
    private var modelReady = false
    private var japaneseReady = false
    private val cache = object : LinkedHashMap<String, String>(256, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, String>?) = size > 3000
    }

    override fun translate(texts: List<String>): List<String> {
        if (!modelReady) {
            Tasks.await(client.downloadModelIfNeeded(DownloadConditions.Builder().build()))
            modelReady = true
        }
        return texts.map { src ->
            cache.getOrPut(src) {
                when {
                    // Suono già spiegato in italiano da TextCleaner: lo lascio così.
                    src.endsWith(")") && src.contains(" (") -> src
                    TextCleaner.isJapanese(src) -> {
                        if (!japaneseReady) {
                            Tasks.await(japanese.downloadModelIfNeeded(DownloadConditions.Builder().build()))
                            japaneseReady = true
                        }
                        Tasks.await(japanese.translate(src))
                    }
                    else -> Tasks.await(client.translate(sentenceCase(src)))
                }
            }
        }
    }

    private fun clientFrom(language: String) = Translation.getClient(
        TranslatorOptions.Builder()
            .setSourceLanguage(language)
            .setTargetLanguage(TranslateLanguage.ITALIAN)
            .build()
    )

    companion object {
        /**
         * I fumetti sono spesso TUTTO MAIUSCOLO, che il traduttore gestisce male:
         * lo porto in minuscolo con la maiuscola a inizio frase.
         */
        fun sentenceCase(text: String): String {
            val letters = text.filter { it.isLetter() }
            if (letters.isEmpty() || letters.count { it.isUpperCase() } < letters.length * 0.7) return text
            val sb = StringBuilder(text.lowercase())
            var capitalize = true
            for (i in sb.indices) {
                val c = sb[i]
                if (capitalize && c.isLetter()) {
                    sb[i] = c.uppercaseChar()
                    capitalize = false
                } else if (c == '.' || c == '!' || c == '?') {
                    capitalize = true
                }
            }
            // "I" inglese resta maiuscolo (I, I'm, I'll...).
            return sb.toString().replace(Regex("""\bi\b"""), "I")
        }
    }
}
