plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "it.pask.traduttorefumetti"
    compileSdk = 35

    defaultConfig {
        applicationId = "it.pask.traduttorefumetti"
        minSdk = 26
        targetSdk = 35
        versionCode = 14
        versionName = "0.14"
        // Solo telefoni a 64 bit: l'APK pesa molto meno
        ndk { abiFilters += "arm64-v8a" }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        resources {
            excludes += setOf(
                "META-INF/DEPENDENCIES",
                "META-INF/LICENSE*",
                "META-INF/NOTICE*",
                "META-INF/INDEX.LIST",
                "META-INF/*.kotlin_module",
                "META-INF/versions/**",
            )
        }
    }
}

dependencies {
    // OCR sul telefono, offline (alfabeto latino, modello incluso nell'app)
    implementation("com.google.mlkit:text-recognition:16.0.1")
    // OCR giapponese (kanji e kana), anch'esso sul telefono
    implementation("com.google.mlkit:text-recognition-japanese:16.0.1")
    // Traduzione inglese -> italiano sul telefono, gratis e offline
    implementation("com.google.mlkit:translate:17.0.3")
    // Gemma sul telefono (sperimentale): motore LLM di Google MediaPipe, offline
    implementation("com.google.mediapipe:tasks-genai:0.10.24")
    // SDK ufficiale Anthropic per chiamare Claude (opzionale, a pagamento)
    implementation("com.anthropic:anthropic-java:2.71.0")
}
