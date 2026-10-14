package it.pask.traduttorefumetti

/**
 * Corregge gli errori tipici dell'OCR sul lettering dei fumetti prima di tradurre:
 * "!!" letti come "l" o "I", lettere allungate ("AWAYYY"), cifre al posto di lettere,
 * e riconosce i suoni (WHOOSH, BOOM...) anche se letti un po' storti.
 */
object TextCleaner {

    /** Suono inglese -> significato in italiano, mostrato tra parentesi. */
    private val SOUNDS = mapOf(
        "whoosh" to "spostamento d'aria", "woosh" to "spostamento d'aria", "swoosh" to "fruscio veloce",
        "fwoosh" to "fiammata", "swish" to "fruscio", "zoom" to "sfreccia", "vroom" to "rombo di motore",
        "boom" to "esplosione", "kaboom" to "esplosione", "bam" to "colpo", "bang" to "sparo",
        "pow" to "pugno", "wham" to "colpo forte", "whack" to "botta", "bonk" to "botta in testa",
        "smack" to "schiaffo", "slap" to "schiaffo", "punch" to "pugno", "kick" to "calcio",
        "crash" to "schianto", "smash" to "fracasso", "crack" to "crepa", "snap" to "schiocco",
        "thud" to "tonfo", "thump" to "tonfo", "slam" to "sbattuta", "stomp" to "passo pesante",
        "clang" to "clangore metallico", "clank" to "rumore metallico", "click" to "clic",
        "creak" to "scricchiolio", "crunch" to "scricchiolio", "rumble" to "rombo", "roar" to "ruggito",
        "growl" to "ringhio", "grr" to "ringhio", "hiss" to "sibilo", "buzz" to "ronzio", "zap" to "scarica",
        "splash" to "schizzo d'acqua", "drip" to "gocciolio", "sizzle" to "sfrigolio", "flash" to "lampo",
        "slash" to "fendente", "shing" to "lama sguainata", "stab" to "pugnalata", "slice" to "taglio",
        "gasp" to "sussulto", "sigh" to "sospiro", "huff" to "sbuffo", "hmph" to "sbuffo",
        "pant" to "affanno", "gulp" to "deglutisce", "sniff" to "annusa", "argh" to "urlo",
        "aargh" to "urlo", "ugh" to "disgusto", "tch" to "schiocco di lingua", "shh" to "silenzio",
        "haha" to "risata", "hahaha" to "risata", "heh" to "risatina", "hehe" to "risatina",
        "boing" to "rimbalzo", "poof" to "sparisce", "pop" to "scoppio", "ding" to "campanello",
        "ring" to "squillo", "knock" to "bussare", "beep" to "bip", "rustle" to "fruscio",
        "flap" to "battito d'ali", "thwip" to "lancio", "fwip" to "lancio", "tremble" to "tremito",
        "shake" to "scossa", "grab" to "afferra", "grip" to "stretta",
    )

    /** Parole comuni da non scambiare per suoni simili (es. "ROOM" non è "BOOM"). */
    private val COMMON = setOf(
        "room", "rush", "push", "wish", "fish", "dish", "bash", "cash", "wash", "pant", "bring",
        "thing", "king", "sing", "wing", "string", "boat", "boot", "book", "look", "took", "cook",
        "shock", "stuck", "luck", "back", "pack", "sack", "trick", "stick", "black", "slip", "stop",
        "shop", "drop", "crop", "top", "cap", "map", "rap", "grap", "this", "his", "miss", "kiss",
        "bus", "but", "mum", "hum", "ham", "bad", "ban", "bat", "pot", "pod", "now", "how", "cow",
        "row", "low", "slow", "show", "who", "why", "what", "when", "dash", "flesh", "fresh",
        "fang", "hang", "gang", "sang", "ding", "ring",
    )

    /** Parole inglesi in ordine di frequenza (parola -> posizione), caricate dagli asset all'avvio. */
    @Volatile
    var words: Map<String, Int> = emptyMap()

    fun loadWords(lines: Sequence<String>) {
        val m = HashMap<String, Int>(40_000)
        lines.forEachIndexed { i, w -> if (w.isNotBlank()) m.putIfAbsent(w.trim(), i) }
        words = m
    }

    private val TWO_LETTER = setOf(
        "of", "to", "in", "is", "it", "on", "be", "as", "at", "by", "we", "he", "or", "an", "my",
        "do", "if", "me", "up", "so", "no", "go", "us", "am", "oh",
    )

    private val CJK = Regex("[\\u3040-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uFF66-\\uFF9F]")

    fun isJapanese(text: String): Boolean = CJK.containsMatchIn(text)

    /** Testo che probabilmente è stato letto male. */
    fun looksBroken(text: String): Boolean {
        val words = Regex("[A-Za-z]+").findAll(text).map { it.value }.toList()
        if (words.isEmpty()) return true
        val odd = words.count { w ->
            w.length >= 3 && (w.none { it.lowercaseChar() in "aeiouy" } ||
                (w.drop(1).any { it.isUpperCase() } && w.drop(1).any { it.isLowerCase() }))
        }
        val junk = text.count { !it.isLetterOrDigit() && !it.isWhitespace() && it !in ".,!?'\"-…:;()" }
        return odd * 2 > words.size || junk > text.length / 4
    }

    fun clean(raw: String): String {
        if (isJapanese(raw)) return raw.trim()
        var t = raw.replace('|', 'I').replace('’', '\'').replace('‘', '\'')
            .replace(Regex("[^A-Za-z0-9 .,!?'\"\\-…:;()]"), " ")
        t = fixDigits(t)
        // "AWAYYl!" / "NOOOI" : le "!" lette come l o I alla fine di una parola allungata.
        t = t.replace(Regex("([A-Za-z])\\1+[lI1]+(?=[!?.]*(\\s|$))")) { "${it.groupValues[1]}${it.groupValues[1]}!" }
        // "!Il" dopo un punto esclamativo = altri punti esclamativi.
        t = t.replace(Regex("!+[lI1]+(?=\\s|$)"), "!!")
        // Lettere ripetute 3+ volte -> una ("AWAYYY" -> "AWAY"); doppie finali di vocali/y/h -> una.
        t = t.replace(Regex("([A-Za-z])\\1{2,}"), "$1")
        t = t.replace(Regex("([AaIiUuYyHhWw])\\1(?=[!?.,]*(\\s|$))"), "$1")
        t = t.replace(Regex("([!?])[!?]+"), "$1$1").replace(Regex("\\s+"), " ").trim()
        t = fixWords(t)
        return sound(t) ?: t
    }

    /**
     * Con il dizionario: rimette la lettera iniziale o finale persa ("Etween" -> "Between"),
     * separa le parole attaccate ("Comestoahead" -> "Comes to a head") e toglie i "!!"
     * letti come lettere alla fine ("headie" -> "head!!").
     */
    fun fixWords(text: String): String {
        if (words.isEmpty()) return text
        val tokens = Regex("[A-Za-z]+").findAll(text).toList()
        if (tokens.isEmpty()) return text
        val sb = StringBuilder()
        var last = 0
        tokens.forEachIndexed { idx, m ->
            sb.append(text, last, m.range.first)
            val isLast = idx == tokens.lastIndex && text.substring(m.range.last + 1).all { !it.isLetterOrDigit() }
            sb.append(fixWord(m.value, isLast))
            last = m.range.last + 1
        }
        sb.append(text.substring(last))
        return sb.toString()
    }

    private fun known(w: String) = w in words

    private fun fixWord(token: String, atEnd: Boolean): String {
        val low = token.lowercase()
        if (low.length < 4 || known(low)) return token
        repair(low)?.let { return styled(it, token) }
        if (atEnd) {
            // "!!" finali letti come lettere: "headie", "AWAYIl".
            for (cut in 3 downTo 1) {
                if (low.length - cut < 3) continue
                val tail = low.takeLast(cut)
                if (tail.any { it !in "iel" }) continue
                val base = low.dropLast(cut)
                val fixed = if (known(base)) base else repair(base) ?: continue
                return styled(fixed, token) + "!!"
            }
        }
        return token
    }

    /** Parola sconosciuta -> versione corretta, o null se non trovo niente di sicuro. */
    private fun repair(low: String): String? {
        // Lettera mancante all'inizio o alla fine (tipico delle scritte a contorno).
        var best: String? = null
        var bestRank = MAX_RANK_FIX
        for (c in 'a'..'z') {
            for (cand in listOf("$c$low", "$low$c")) {
                val r = words[cand] ?: continue
                if (r < bestRank) { best = cand; bestRank = r }
            }
        }
        if (best != null) return best
        if (low.length >= 6) segment(low)?.let { return it.joinToString(" ") }
        return null
    }

    /** Divide una parola attaccata in parole del dizionario, preferendo parole lunghe e comuni. */
    private fun segment(s: String): List<String>? {
        val n = s.length
        val cost = DoubleArray(n + 1) { Double.MAX_VALUE }
        val from = IntArray(n + 1) { -1 }
        cost[0] = 0.0
        for (end in 1..n) for (start in maxOf(0, end - 20) until end) {
            if (cost[start] == Double.MAX_VALUE) continue
            val w = s.substring(start, end)
            val ok = when (w.length) {
                1 -> w == "a" || w == "i"
                2 -> w in TWO_LETTER
                else -> (words[w] ?: Int.MAX_VALUE) < MAX_RANK_SEGMENT
            }
            if (!ok) continue
            val c = cost[start] + 1.0 + kotlin.math.ln((words[w] ?: 0) + 2.0) / 4.0
            if (c < cost[end]) { cost[end] = c; from[end] = start }
        }
        if (from[n] < 0) return null
        val parts = ArrayList<String>()
        var i = n
        while (i > 0) { parts += s.substring(from[i], i); i = from[i] }
        parts.reverse()
        val ok = parts.size >= 2 && n.toDouble() / parts.size >= 2.5 && parts.last() != "i"
        return if (ok) parts else null
    }

    /** Ricopia lo stile della parola originale: TUTTO MAIUSCOLO, Iniziale maiuscola o minuscolo. */
    private fun styled(fixed: String, original: String): String {
        val letters = original.filter { it.isLetter() }
        return when {
            letters.length > 1 && letters.count { it.isUpperCase() } >= letters.length * 0.7 -> fixed.uppercase()
            original.first().isUpperCase() -> fixed.replaceFirstChar { it.uppercase() }
            else -> fixed
        }
    }

    private const val MAX_RANK_FIX = 8000
    private const val MAX_RANK_SEGMENT = 15000

    /** Dentro le parole, cifre lette al posto di lettere: 0->O, 1->I, 5->S, 8->B. */
    private fun fixDigits(t: String): String =
        t.replace(Regex("[A-Za-z0-9]+")) { m ->
            val w = m.value
            if (w.any { it.isLetter() } && w.any { it.isDigit() } && w.count { it.isLetter() } >= w.length / 2) {
                w.map {
                    when (it) {
                        '0' -> 'O'; '1' -> 'I'; '5' -> 'S'; '8' -> 'B'; '4' -> 'A'; else -> it
                    }
                }.joinToString("")
            } else w
        }

    /** Se il testo è un solo suono, lo riscrive corretto con il significato tra parentesi. */
    private fun sound(t: String): String? {
        val words = t.split(' ').map { it.trim('!', '?', '.', ',', '-', '\'', '"', '…') }.filter { it.isNotEmpty() }
        if (words.isEmpty() || words.size > 2) return null
        val found = words.map { w -> matchSound(w) ?: return null }
        val shout = if (t.contains('!')) "!" else ""
        val meaning = found.map { SOUNDS.getValue(it) }.distinct().joinToString(", ")
        return found.joinToString(" ") { it.uppercase() } + shout + " ($meaning)"
    }

    private fun matchSound(word: String): String? {
        // Togliamo code tipiche di "!!" letti male: "WHOOSHIr" -> "WHOOSH".
        val base = word.lowercase().trimEnd('l', 'i', 'r', '1')
        val candidates = listOf(word.lowercase(), base).filter { it.length >= 2 }.distinct()
        for (c in candidates) {
            if (c in COMMON) return null
            SOUNDS.keys.firstOrNull { it == c }?.let { return it }
        }
        // Somiglianza: lettere spesso confuse (M/W, N/H...) costano poco.
        for (c in candidates) {
            // Le parole corte somigliano troppo a parole vere (STAY/STAB): niente somiglianza sotto le 5 lettere.
            if (c.length < 5) continue
            val limit = if (c.length >= 7) 2 else 1
            val best = SOUNDS.keys.filter { it.length >= 5 }
                .map { it to distance(c, it) }.minByOrNull { it.second } ?: continue
            if (best.second <= limit) return best.first
        }
        return null
    }

    private val SIMILAR = setOf("mw", "wm", "nh", "hn", "oa", "ao", "ce", "ec", "il", "li", "uv", "vu", "rn")

    /** Distanza di modifica, con sostituzioni tra lettere simili che contano metà. */
    private fun distance(a: String, b: String): Int {
        val d = Array(a.length + 1) { DoubleArray(b.length + 1) }
        for (i in 0..a.length) d[i][0] = i.toDouble()
        for (j in 0..b.length) d[0][j] = j.toDouble()
        for (i in 1..a.length) for (j in 1..b.length) {
            val sub = when {
                a[i - 1] == b[j - 1] -> 0.0
                "${a[i - 1]}${b[j - 1]}" in SIMILAR -> 0.5
                else -> 1.0
            }
            d[i][j] = minOf(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + sub)
        }
        return kotlin.math.ceil(d[a.length][b.length]).toInt()
    }
}
