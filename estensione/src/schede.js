// Schede già pronte per le serie più lette: il punto di partenza, poi ognuno la arricchisce dal popup.
// Una riga per cosa: "inglese = italiano" per nomi e termini, frasi libere per come parlano i personaggi.

const SCHEDE = [
  {
    titolo: /one\s*piece/i,
    testo: `Edizione italiana di riferimento: Star Comics.
Straw Hat = Cappello di Paglia
Straw Hat Pirates / Straw Hats = Pirati di Cappello di Paglia, la ciurma di Cappello di Paglia
crew = ciurma
Luffy, Zoro, Nami, Usopp, Sanji, Chopper, Robin, Franky, Brook, Jinbe: nomi che restano uguali
Devil Fruit = Frutto del Diavolo
Haki = Ambizione
Armament Haki = Ambizione dell'armatura
Observation Haki = Ambizione della percezione
Conqueror's Haki = Ambizione del re conquistatore
Marines / Navy = la Marina
World Government = Governo Mondiale
Celestial Dragons = Draghi Celesti
Five Elders = Cinque Astri di Saggezza
Emperors / Yonko = Imperatori
Grand Line = Rotta Maggiore
New World = Nuovo Mondo
Mary Geoise = Marijoa
Den Den Mushi = lumacofono
Sea King = Re del mare
Elbaph = Elbaph (si scrive con la ph)
Underworld = Oltretomba
Loki, Harald, Shanks, Sommers, Imu: nomi che restano uguali
Imu parla di sé in terza persona ("Imu te lo ordina").
Luffy parla in modo semplice, diretto e informale.
Le onomatopee e i versi si lasciano corti (es. "Gyaaah!", "Anf anf").`,
  },
];

/** La scheda già pronta per questo titolo, se c'è. */
export function schedaPronta(titolo) {
  return SCHEDE.find(s => s.titolo.test(titolo || ''))?.testo || '';
}
