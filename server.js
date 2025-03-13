const fastify = require('fastify')({ logger: true });
const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

// Configurazione avanzata del parser XML
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  alwaysCreateTextNode: true,
  trimValues: true,
  removeNSPrefix: true,
  isArray: (name, jpath) => ['E1EDKA1', 'E1EDP01'].includes(name)
});

// Funzioni di utilità
const safeExtract = (obj, path, def = '') => {
  return path.split('.').reduce((acc, key) => acc?.[key]?.['#text'] ?? acc?.[key] ?? def, obj) || def;
};

const formatDate = (date) => date ? date.replace(/-/g, '') : '';
const formatTime = (time) => time ? time.replace(/:/g, '') : '';
const formatNumber = (num, decimals = 2) => {
  const n = parseFloat(num) || 0;
  return n.toFixed(decimals).replace('.', ',');
};

// Mappatura IDOC -> EDI
function mapToEDI(data) {
  const IDOC = data.IDOC || {};
  console.log(data.IDOC)
  const segments = [];
  const items = IDOC.E1EDP01 || [];

  // Segmenti di testata
  segments.push(
    `UNB+UNOC:3+${safeExtract(IDOC, 'EDI_DC40.SNDPOR')}:92+${safeExtract(IDOC, 'EDI_DC40.RCVPOR')}:91+` +
    `${formatDate(safeExtract(IDOC, 'EDI_DC40.CREDAT'))}${formatTime(safeExtract(IDOC, 'EDI_DC40.CRETIM'))}+2569'`,
    `UNH+INVOIC:D:07A:UN:GA0131'`,
    `BGM+380:${safeExtract(IDOC, 'E1EDK01.BELNR')}+9'`,
    `DTM+137:${formatDate(safeExtract(IDOC, 'E1EDK01.BLDAT'))}:102'`,
    `DTM+1:${formatDate(safeExtract(IDOC, 'E1EDK02.DATUM'))}:102'`,
    `FTX+TXD:TAXFREE SUPPLY'`,
    `GEI+PM+::272'`
  );

  // Partner commerciali
  const partners = IDOC.E1EDKA1 || [];
  partners.forEach(partner => {
    const parvw = safeExtract(partner, 'PARVW');
    const partn = safeExtract(partner, 'PARTN');
    const address = [
      safeExtract(partner, 'STRAS'),
      safeExtract(partner, 'ORT1'),
      safeExtract(partner, 'PSTLZ'),
      safeExtract(partner, 'LAND1')
    ].filter(Boolean).join('+');

    if(parvw === 'RS') {
      segments.push(
        `NAD+ST+:${partn}::92++${address}'`,
        `RFF+VA:${safeExtract(partner, 'PAORG')}'`
      );
    }
    if(parvw === 'RE') {
      segments.push(
        `NAD+BY+:${partn}::92++${address}'`,
        `RFF+VA:${safeExtract(IDOC, 'E1EDK01.KUNDEUINR')}'`,
        `RFF+XA:${safeExtract(IDOC, 'E1EDK01.KUNDEUINR')}'`
      );
    }
  });

  // Dati pagamento
  segments.push(
    `CUX+2::${safeExtract(IDOC, 'E1EDK01.WAERK')}:4'`,
    `DTM+134:${formatDate(safeExtract(IDOC, 'E1EDK03.DATUM'))}:102'`,
    `PYT+1++:2+D+30'`,
    `DTM+171:${formatDate(safeExtract(IDOC, 'E1EDK03.DATUM'))}:102'`,
    `FII+BF+:${safeExtract(IDOC, 'E1EDS01.KNUMV')}'`
  );

  // Righe documento
  items.forEach((item, index) => {
    segments.push(
      `LIN+:${index + 1}++${safeExtract(item, 'IDTNR')}:IN'`,
      `IMD+++1:++11::272:${safeExtract(item, 'KTEXT')}'`,
      `QTY+47::${safeExtract(item, 'MENGE')}:PCE'`,
      `ALI+:${safeExtract(item, 'HERKL')}'`,
      `MOA+203:${formatNumber(safeExtract(item, 'E1EDK05.KRATE'))}:EUR'`,
      `PRI+AAA:${formatNumber(safeExtract(item, 'E1EDK05.UPRBS'), 2)}::PCE:1'`,
      `RFF+ON::${safeExtract(item, 'XABLN')}'`,
      `RFF+AAK:${safeExtract(item, 'E1EDP04.MSATZ')}'`,
      `DTM+171:${formatDate(safeExtract(IDOC, 'E1EDK03.DATUM'))}:102'`,
      `TAX+7:VAT+++:::0'`
    );
  });

  // Totali
  segments.push(
    `CNT+2:${items.length}'`,
    `MOA+77:${formatNumber(safeExtract(IDOC, 'E1EDS01.SUMME'))}:EUR'`,
    `MOA+125:${formatNumber(safeExtract(IDOC, 'E1EDS01.BTWR'))}:EUR'`,
    `MOA+176:0,00:EUR'`,
    `MOA+79:${formatNumber(safeExtract(IDOC, 'E1EDS01.SUMME'))}:EUR'`,
    `MOA+403:0,00:EUR'`,
    `TAX+7:VAT+++:::0'`,
    `MOA+124:0,00:EUR'`,
    `MOA+125:${formatNumber(safeExtract(IDOC, 'E1EDS01.BTWR'))}:EUR'`,
    `UNT+39:39'`,
    `UNZ+1+1:2569'`
  );

  return segments.join('\n');
}

// Endpoint
fastify.post("/process-invoice", async (request, reply) => {
  try {
    const xmlPath = path.join(__dirname, "test/InvoiceIdoc.xml");
    const ediPath = path.join(__dirname, "test/IDOC_EDI.txt");

    const xmlData = fs.readFileSync(xmlPath, "utf8");
    const jsonData = parser.parse(xmlData);

    const ediContent = mapToEDI(jsonData);
    fs.writeFileSync(ediPath, ediContent);

    return {
      status: "Conversione completata",
      path: ediPath,
      content: ediContent,
    };
  } catch (err) {
    fastify.log.error(err);
    reply.code(500).send({ error: "Errore di conversione" });
  }
});

// Avvio server
const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: "0.0.0.0" });
    fastify.log.info(`Server in ascolto su ${fastify.server.address().port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();