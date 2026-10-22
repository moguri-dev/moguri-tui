import { crc32, deflateRawSync } from "node:zlib";

export interface GeneratedZipEntry { name: string; text?: string; bytes?: Buffer; flags?: number; size?: number; crc?: number }
export function generatedZip(entries: GeneratedZipEntry[]): Buffer {
  const local: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), data = entry.bytes ?? Buffer.from(entry.text ?? ""), compressed = deflateRawSync(data);
    const checksum = entry.crc ?? crc32(data), size = entry.size ?? data.length, flags = 0x800 | (entry.flags ?? 0);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(flags, 6); header.writeUInt16LE(8, 8);
    header.writeUInt32LE(checksum, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(size, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, compressed);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(flags, 8); directory.writeUInt16LE(8, 10);
    directory.writeUInt32LE(checksum, 16); directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(size, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
    central.push(directory, name); offset += header.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
export const wordNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const sheetNamespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const relationshipNamespace = "http://schemas.openxmlformats.org/package/2006/relationships";
export function generatedOfficeEntries(format: "docx" | "xlsx"): GeneratedZipEntry[] {
  const main = format === "docx" ? "word/document.xml" : "xl/workbook.xml";
  return [
    { name: "[Content_Types].xml", text: `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/${main}" ContentType="application/vnd.openxmlformats-officedocument.${format === "docx" ? "wordprocessingml.document" : "spreadsheetml.sheet"}.main+xml"/></Types>` },
    { name: "_rels/.rels", text: `<Relationships xmlns="${relationshipNamespace}"><Relationship Id="generated-office" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${main}"/></Relationships>` },
    ...(format === "docx" ? [
      { name: "word/document.xml", text: `<w:document xmlns:w="${wordNamespace}"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Generated heading</w:t></w:r></w:p><w:p><w:r><w:t>GENERATED_DOCUMENT_SECRET body paragraph \u{1f34a}</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Generated table cell A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Generated table cell B</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>` },
    ] : [
      { name: "xl/workbook.xml", text: `<workbook xmlns="${sheetNamespace}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Generated sheet" sheetId="1" r:id="generated-sheet"/><sheet name="Generated hidden" sheetId="2" state="hidden" r:id="generated-hidden"/></sheets></workbook>` },
      { name: "xl/_rels/workbook.xml.rels", text: `<Relationships xmlns="${relationshipNamespace}"><Relationship Id="generated-sheet" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="generated-hidden" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>` },
      { name: "xl/sharedStrings.xml", text: `<sst xmlns="${sheetNamespace}"><si><t>GENERATED_DOCUMENT_SECRET shared value</t><rPh sb="0" eb="9"><t>GENERATED_PHONETIC_GUIDE</t></rPh></si></sst>` },
      { name: "xl/worksheets/sheet1.xml", text: `<worksheet xmlns="${sheetNamespace}"><dimension ref="A1:XFD1048576"/><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>2</v></c><c r="C1"><f>1+2</f><v>999</v></c><c r="D1" t="str"><f>WEBSERVICE("https://generated.invalid/never-fetch")</f></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Generated inline \u{1f34a}</t></is></c></row></sheetData></worksheet>` },
      { name: "xl/worksheets/sheet2.xml", text: `<worksheet xmlns="${sheetNamespace}"><sheetData><row r="1"><c r="A1"><f t="shared" si="7" ref="A1:A2">SUM('Generated sheet'!B1:C1)</f><v>5</v></c></row><row r="2"><c r="A2"><f t="shared" si="7"/><v>5</v></c></row></sheetData></worksheet>` },
    ]),
  ];
}
export const generatedDocx = () => generatedZip(generatedOfficeEntries("docx"));
export const generatedXlsx = () => generatedZip(generatedOfficeEntries("xlsx"));
export function generatedPdf(options: { pages?: number; imagePage?: boolean; encrypted?: boolean; text?: string } = {}): Buffer {
  const pages = options.pages ?? 2, objects: Buffer[] = [], add = (value: string | Buffer) => { objects.push(Buffer.isBuffer(value) ? value : Buffer.from(value, "latin1")); return objects.length; };
  add("<< /Type /Catalog /Pages 2 0 R >>"); add(""); add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const refs: number[] = [];
  for (let index = 0; index < pages; index++) {
    const content = options.imagePage && index === pages - 1 ? "q 1 0 0 1 0 0 cm /Im Do Q" : `BT /F1 12 Tf 50 750 Td (${(options.text ?? `Generated PDF page ${index + 1} GENERATED_DOCUMENT_SECRET`).replace(/[\\()]/g, "\\$&")}) Tj ET`;
    const page = add(""), stream = add(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);
    let image = "";
    if (options.imagePage && index === pages - 1) {
      const id = add(Buffer.concat([Buffer.from("<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 3 >>\nstream\n"), Buffer.from([20, 80, 40]), Buffer.from("\nendstream")]));
      image = ` /XObject << /Im ${id} 0 R >>`;
    }
    objects[page - 1] = Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >>${image} >> /Contents ${stream} 0 R >>`);
    refs.push(page);
  }
  objects[1] = Buffer.from(`<< /Type /Pages /Count ${pages} /Kids [${refs.map((id) => `${id} 0 R`).join(" ")}] >>`);
  const encryption = options.encrypted ? add(`<< /Filter /Standard /V 1 /R 2 /Length 40 /P -4 /O <${"01".repeat(32)}> /U <${"02".repeat(32)}> >>`) : null;
  const buffers = [Buffer.from("%PDF-1.7\n")], offsets = [0]; let position = buffers[0]!.length;
  objects.forEach((object, index) => { offsets.push(position); const bytes = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from("\nendobj\n")]); buffers.push(bytes); position += bytes.length; });
  buffers.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${encryption ? ` /Encrypt ${encryption} 0 R /ID [<${"03".repeat(16)}> <${"03".repeat(16)}>]` : ""} >>\nstartxref\n${position}\n%%EOF\n`));
  return Buffer.concat(buffers);
}
