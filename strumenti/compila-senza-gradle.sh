#!/usr/bin/env bash
# Compila l'APK senza Android SDK completo né Gradle (per ambienti che non raggiungono i server di Google).
# Variabili richieste:
#   AAPT2      eseguibile aapt2 (pacchetto PyPI "aapt2")
#   ANDROID_JAR android.jar API 34
#   R8_JAR     r8lib.jar ufficiale (storage.googleapis.com/r8-releases)
#   KOTLINC_CP classpath del compilatore Kotlin (kotlin-compiler-embeddable e dipendenze)
#   LIBS       cartella con i jar di runtime (anthropic-java e dipendenze, kotlin-stdlib)
#   APKSIG_JAR apksig.jar
#   KEYSTORE / KEYPASS  chiave di firma PKCS12
#   OUT        percorso dell'APK finale
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
W="$(mktemp -d)"
APP="$ROOT/app/src/main"
VERSION_NAME="${VERSION_NAME:-0.2}"
VERSION_CODE="${VERSION_CODE:-2}"

# 1. Risorse
sed 's#<manifest #<manifest package="it.pask.traduttorefumetti" #' "$APP/AndroidManifest.xml" > "$W/AndroidManifest.xml"
"$AAPT2" compile --dir "$APP/res" -o "$W/res.zip"
mkdir -p "$W/gen" "$W/classes" "$W/dex" "$W/libs"
"$AAPT2" link -I "$ANDROID_JAR" --manifest "$W/AndroidManifest.xml" \
  --min-sdk-version 26 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  --java "$W/gen" -o "$W/base.apk" "$W/res.zip"

# 2. Codice Kotlin + R.java
CP="$ANDROID_JAR:$(ls "$LIBS"/*.jar | tr '\n' ':')"
java -cp "$KOTLINC_CP" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -jvm-target 17 \
  -cp "$CP" -d "$W/classes" $(find "$APP/java" -name '*.kt') $(find "$W/gen" -name '*.java')
javac -nowarn --release 17 -cp "$ANDROID_JAR" -d "$W/classes" $(find "$W/gen" -name '*.java')
(cd "$W/classes" && zip -qr "$W/app.jar" .)

# 3. Librerie: tolgo le classi per versioni Java recenti (META-INF/versions), poi DEX con D8
for j in "$LIBS"/*.jar; do
  cp "$j" "$W/libs/"; zip -qd "$W/libs/$(basename "$j")" 'META-INF/versions/*' 'module-info.class' >/dev/null 2>&1 || true
done
java -cp "$R8_JAR" com.android.tools.r8.D8 --release --min-api 26 --lib "$ANDROID_JAR" \
  --output "$W/dex" "$W/app.jar" "$W"/libs/*.jar

# 4. APK: risorse + dex + file non-classe delle librerie (servono a Kotlin reflect)
cp "$W/base.apk" "$W/unsigned.apk"
(cd "$W/dex" && zip -q "$W/unsigned.apk" classes*.dex)
mkdir -p "$W/javares"
for j in "$W"/libs/*.jar; do
  (cd "$W/javares" && unzip -qo "$j" -x '*.class' 'META-INF/MANIFEST.MF' 'META-INF/*.SF' 'META-INF/*.RSA' 'META-INF/*.DSA' 'META-INF/maven/*' 'META-INF/versions/*' 'META-INF/LICENSE*' 'META-INF/NOTICE*' 'META-INF/DEPENDENCIES' 2>/dev/null || true)
done
find "$W/javares" -type d -empty -delete
if [ -d "$W/javares" ]; then (cd "$W/javares" && zip -qr "$W/unsigned.apk" .); fi

# 5. Allineamento e firma
python3 "$ROOT/strumenti/allinea.py" "$W/unsigned.apk" "$W/aligned.apk"
javac -nowarn -cp "$APKSIG_JAR" -d "$W/firma" "$ROOT/strumenti/Firma.java"
java --add-exports java.base/sun.security.x509=ALL-UNNAMED --add-exports java.base/sun.security.pkcs=ALL-UNNAMED --add-opens java.base/sun.security.x509=ALL-UNNAMED --add-opens java.base/sun.security.pkcs=ALL-UNNAMED -cp "$APKSIG_JAR:$W/firma" Firma "$KEYSTORE" "$KEYPASS" "$W/aligned.apk" "$OUT"
echo "APK pronto: $OUT"
