const fastify = require("fastify")({ logger: true });
const fs = require("fs");
const path = require("path");
const { XMLParser } = require("fast-xml-parser");

// Configurazione avanzata del parser XML
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  alwaysCreateTextNode: true,
  trimValues: true,
  removeNSPrefix: true,
  isArray: (name, jpath) => ["E1EDKA1", "E1EDP01"].includes(name),
});

// Funzioni di utilità
const toArray = (obj) => {
  if (!obj) return [];
  return Array.isArray(obj) ? obj : [obj];
};

const safeExtract = (obj, path, def = "") => {
  return (
    path.split(".").reduce((acc, key) => {
      const value = acc?.[key];
      return value?.["#text"] ?? value ?? def;
    }, obj) || def
  );
};

const formatDate = (date) => (date ? date.replace(/-/g, "") : "");
const formatTime = (time) => (time ? time.replace(/:/g, "") : "");
const formatNumber = (num, decimals = 2) => {
  const n = parseFloat(num) || 0;
  return n.toFixed(decimals).replace(".", ",");
};

function mapToEDI(data) {
  const IDOC = data.IDOC || {};

  // Estrazione centralizzata di tutti i segmenti IDOC
  const EDI_DC40 = IDOC.EDI_DC40 || {};
  const E1EDK01 = IDOC.E1EDK01 || {};
  const E1EDK02 = IDOC.E1EDK02 || {};
  const E1EDK03 =
    toArray(IDOC.E1EDK03).find((e) => safeExtract(e, "IDDAT") === "026") || {};
  const E1EDKA1 = IDOC.E1EDKA1 || [];
  const E1EDK18 = IDOC.E1EDK18 || {};
  const E1EDS01 = IDOC.E1EDS01 || {};

  // Estrazione gerarchica della E1EDP01
  const E1EDP01 = toArray(IDOC.E1EDP01).map((item) => ({
    POSEX: safeExtract(item, "POSEX"),
    IDTNR: safeExtract(item, "IDTNR"),
    KTEXT: safeExtract(item, "KTEXT"),
    MENGE: safeExtract(item, "MENGE"),
    MENEE: safeExtract(item, "MENEE"),
    HERKL: safeExtract(item, "HERKL"),
    XABLN: safeExtract(item, "XABLN"),
    E1EDK05: {
      KRATE: safeExtract(item.E1EDK05, "KRATE"),
      MEAUN: safeExtract(item.E1EDK05, "MEAUN"),
      UPRBS: safeExtract(item.E1EDK05, "UPRBS"),
    },
    E1EDP19: {
      TAXCD: safeExtract(item.E1EDP19, "TAXCD"),
      NETWR: safeExtract(item.E1EDP19, "NETWR"),
      MWSBT: safeExtract(item.E1EDP19, "MWSBT"),
    },
    E1EDP04: {
      MSATZ: safeExtract(item.E1EDP04, "MSATZ"),
    },
  }));

  const segments = [];

  // SEZIONE TESTATA
  segments.push(
    // Segmento UNB
    `UNB+UNOC:3+${safeExtract(EDI_DC40, "SNDPOR")}:92+${safeExtract(    
      EDI_DC40,
      "RCVPOR"
    )}:91+` +
      `${formatDate(safeExtract(EDI_DC40, "CREDAT"))}${formatTime(
        safeExtract(EDI_DC40, "CRETIM")
      )}+2569'`,

    // Segmento UNH
    `UNH+INVOIC:D:07A:UN:GA0131'`,

    // Segmento BGM
    `BGM+380:${safeExtract(E1EDK01, "BELNR")}+9'`,

    // Segmenti DTM
    `DTM+137:${formatDate(safeExtract(E1EDK01, "BLDAT"))}:102'`,
    `DTM+1:${formatDate(safeExtract(E1EDK02, "DATUM"))}:102'`,

    // Segmento FTX
    `FTX+TXD:${safeExtract(E1EDK18, "ZTERM_TXT")}'`,

    // Segmento GEI
    `GEI+PM+::272'`
  );

  // PARTNER COMMERCIALI
  toArray(E1EDKA1).forEach((partner) => {
    const partnerData = {
      PARVW: safeExtract(partner, "PARVW"),
      PARTN: safeExtract(partner, "PARTN"),
      NAME1: safeExtract(partner, "NAME1"),
      STRAS: safeExtract(partner, "STRAS"),
      ORT1: safeExtract(partner, "ORT1"),
      PSTLZ: safeExtract(partner, "PSTLZ"),
      LAND1: safeExtract(partner, "LAND1"),
      PAORG: safeExtract(partner, "PAORG"),
    };

    if (partnerData.PARVW === "RS") {
      segments.push(
        `NAD+ST+:${partnerData.PARTN}::92++` +
          `${[
            partnerData.STRAS,
            partnerData.ORT1,
            partnerData.PSTLZ,
            partnerData.LAND1,
          ]
            .filter(Boolean)
            .join("+")}'`,
        `RFF+VA:${partnerData.PAORG}'`
      );
    }
    if (partnerData.PARVW === "RE") {
      segments.push(
        `NAD+BY+:${partnerData.PARTN}::92++` +
          `${[
            partnerData.STRAS,
            partnerData.ORT1,
            partnerData.PSTLZ,
            partnerData.LAND1,
          ]
            .filter(Boolean)
            .join("+")}'`,
        `RFF+VA:${safeExtract(E1EDK01, "KUNDEUINR")}'`,
        `RFF+XA:${safeExtract(E1EDK01, "KUNDEUINR")}'`
      );
    }
  });

  // DATI PAGAMENTO E VALUTA
  segments.push(
    `CUX+2::${safeExtract(E1EDK01, "WAERK")}:4'`,
    `DTM+134:${formatDate(safeExtract(E1EDK03, "DATUM"))}:102'`,
    `PYT+1++:2+D+30'`,
    `DTM+171:${formatDate(safeExtract(E1EDK03, "DATUM"))}:102'`,
    `FII+BF+:${safeExtract(E1EDS01, "KNUMV")}'`
  );

  // RIGHE DOCUMENTO
  E1EDP01.forEach((item, index) => {
    segments.push(
      `LIN+:${index + 1}++${item.IDTNR}:IN'`,
      `IMD+++1:++11::272:${item.KTEXT}'`,
      `QTY+47::${item.MENGE}:${item.MENEE}'`,
      `ALI+:${item.HERKL}'`,
      `MOA+203:${formatNumber(item.E1EDK05.KRATE)}:EUR'`,
      `PRI+AAA:${formatNumber(item.E1EDK05.UPRBS, 2)}::${
        item.E1EDK05.MEAUN
      }:1'`,
      `RFF+ON::${item.XABLN}'`,
      `RFF+AAK:${item.E1EDP04.MSATZ}'`,
      `DTM+171:${formatDate(safeExtract(E1EDK03, "DATUM"))}:102'`,
      `TAX+7:VAT+++:::0'`,
      `MOA+125:${formatNumber(item.E1EDP19.MWSBT)}:EUR'`
    );
  });

  // TOTALI E CHIUSURA
  segments.push(
    `CNT+2:${E1EDP01.length}'`,
    `MOA+77:${formatNumber(safeExtract(E1EDS01, "SUMME"))}:EUR'`,
    `MOA+125:${formatNumber(safeExtract(E1EDS01, "BTWR"))}:EUR'`,
    `MOA+176:0,00:EUR'`,
    `MOA+79:${formatNumber(safeExtract(E1EDS01, "SUMME"))}:EUR'`,
    `MOA+403:0,00:EUR'`,
    `TAX+7:VAT+++:::0'`,
    `MOA+124:0,00:EUR'`,
    `MOA+125:${formatNumber(safeExtract(E1EDS01, "BTWR"))}:EUR'`,
    `UNT+${segments.length + 1}:${segments.length + 1}'`,
    `UNZ+1+1:2569'`
  );

  return segments.join("\n");
}

// Endpoint
fastify.post("/process-invoice", async (request, reply) => {
  try {
    const xmlPath = path.join(__dirname, "test/InvoiceIdoc2.xml");
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
