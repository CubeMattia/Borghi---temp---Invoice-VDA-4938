const fastify = require('fastify')({ logger: true });
const { XMLParser } = require('fast-xml-parser');
const fs = require('fs').promises;
const path = require('path');

// Configurazione del parser per preservare gli attributi senza prefisso
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ""
});

/**
 * Genera dinamicamente la stringa di un segmento EDI.
 * @param {string} segmentTag - Il nome del tag del segmento (es. "EDI_DC40", "E1IDOCENHANCEMENT", …).
 * @param {object} segmentObj - L'oggetto contenente gli elementi del segmento.
 * @returns {string} La stringa EDI del segmento.
 */
function generateSegment(segmentTag, segmentObj) {
  let segmentStr = segmentTag;
  // Itera dinamicamente su tutte le chiavi dell'oggetto segmento
  for (const key in segmentObj) {
    // Escludi attributi che non devono comparire (es. "SEGMENT" o "BEGIN")
    if (key === 'SEGMENT' || key === 'BEGIN') continue;
    let value = segmentObj[key];
    // Se il valore è un oggetto (o un array), lo converto in stringa; se necessario, si potrebbe gestire in modo più specifico
    if (typeof value === 'object' && value !== null) {
      if (Array.isArray(value)) {
        // Unisce gli elementi dell'array separati da una virgola
        value = value.map(item => (typeof item === 'object' ? JSON.stringify(item) : item)).join(',');
      } else {
        value = value.toString();
      }
    }
    segmentStr += '*' + value;
  }
  return segmentStr;
}

/**
 * Genera dinamicamente l'intero contenuto EDI a partire dall'oggetto JSON ottenuto dal file XML.
 * Si assume la seguente struttura:
 * {
 *   ZEWM_G217_IN: {
 *     IDOC: {
 *       BEGIN: "1",
 *       <segmento1>: { ... },
 *       <segmento2>: { ... },
 *       <segmentoN>: { ... }
 *     }
 *   }
 * }
 * @param {object} ediJson - L'oggetto JSON ottenuto dal parsing del file XML.
 * @returns {string} La stringa EDI formattata, con ogni segmento su una nuova riga.
 */
function generateDynamicEdi(ediJson) {
  let segments = [];
  // Naviga dinamicamente fino al nodo IDOC
  const idoc = ediJson?.ZEWM_G217_IN?.IDOC;
  if (!idoc) {
    return 'Formato XML non valido: IDOC non trovato';
  }
  // Itera su tutte le chiavi di IDOC (ad eccezione degli attributi come BEGIN)
  Object.keys(idoc).forEach(key => {
    if (key === 'BEGIN') return; // salta l'attributo
    let segmentData = idoc[key];
    // Se ci sono più occorrenze dello stesso segmento, il parser restituisce un array
    if (Array.isArray(segmentData)) {
      segmentData.forEach(seg => segments.push(generateSegment(key, seg)));
    } else if (typeof segmentData === 'object') {
      segments.push(generateSegment(key, segmentData));
    }
  });
  // Unisce i segmenti: ogni segmento termina con '~' e viene posizionato su una nuova riga
  return segments.map(s => s + '~');
}

// Endpoint Fastify per leggere il file XML locale, generare il contenuto EDI in modo dinamico e salvarlo in un file
fastify.post('/generate-edi', async (request, reply) => {
  try {
    // Definizione dei percorsi per la cartella e i file
    const testFolder = path.join(__dirname, 'test');
    const xmlFilePath = path.join(testFolder, 'test.xml');
    const ediFilePath = path.join(testFolder, 'test.txt');

    // Lettura del file XML in modalità UTF-8
    const xmlData = await fs.readFile(xmlFilePath, 'utf8');
    // Parsing dinamico dell'XML in JSON
    const jsonData = parser.parse(xmlData);
    // Generazione dinamica del contenuto EDI
    const ediContent = generateDynamicEdi(jsonData);

    // Crea la cartella "test" se non esiste già
    await fs.mkdir(testFolder, { recursive: true });
    // Scrittura del contenuto EDI nel file
    await fs.writeFile(ediFilePath, ediContent);

    reply.send({ 
      message: `File EDI generato con successo in ${ediFilePath}`, 
      ediContent 
    });
  } catch (error) {
    reply.status(500).send({
      error: 'Errore durante la lettura, il parsing o la scrittura dei file',
      details: error.message
    });
  }
});

// Utilizzo della nuova sintassi per fastify.listen che accetta un oggetto di opzioni
fastify.listen({ port: 3000, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  fastify.log.info(`Server in ascolto su ${address}`);
});
