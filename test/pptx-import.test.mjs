import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { deckToPptx, docToDocx } from '../src/office.js';
import { pptxToDeck } from '../src/pptx-import.js';

const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lz1l4QAAAABJRU5ErkJggg==';

function deckContent() {
  return {
    w: 1280,
    h: 720,
    slides: [
      {
        id: 's1',
        bg: '#101014',
        notes: 'Presenter note — café',
        transition: { type: 'fade', duration: 600 },
        elements: [
          { id: 't1', type: 'text', x: 96, y: 64, w: 640, h: 120, text: 'Imported heading\nsecond line', size: 44, color: '#f4f4f5', bold: true, italic: true, align: 'center', valign: 'middle', fontFamily: 'Arial', lineHeight: 130, letterSpacing: 1 },
          { id: 'r1', type: 'rect', x: 800, y: 100, w: 200, h: 90, fill: '#16a34a', radius: 12, borderWidth: 3, borderColor: '#ffffff' },
          { id: 'e1', type: 'ellipse', x: 900, y: 380, w: 120, h: 120, fill: '#ef4444' },
          { id: 'i1', type: 'image', x: 120, y: 300, w: 320, h: 180, src: PNG_1X1, alt: 'pixel', fit: 'cover' },
        ],
      },
      {
        id: 's2',
        bg: '#ffffff',
        transition: { type: 'push', duration: 700 },
        elements: [
          { id: 't2', type: 'text', x: 40, y: 40, w: 800, h: 80, text: 'Second slide', size: 32, color: '#111111', align: 'left' },
          { id: 'l1', type: 'line', x: 40, y: 140, w: 400, h: 6, fill: '#e11d48' },
        ],
      },
    ],
  };
}

test('PPTX round-trip keeps slide size, text, geometry, images, notes and transitions', async () => {
  const buffer = await deckToPptx({ filename: 'roundtrip.pptx' }, deckContent(), null);
  const imported = await pptxToDeck(buffer);
  const deck = imported.content;

  assert.equal(deck.w, 1280);
  assert.equal(deck.h, 720);
  assert.equal(deck.slides.length, 2);

  const [first, second] = deck.slides;
  assert.equal(first.bg, '#101014');
  assert.equal(first.notes, 'Presenter note — café');
  assert.equal(first.transition.type, 'fade');
  assert.ok(first.transition.duration >= 150);

  const heading = first.elements.find((el) => el.type === 'text');
  assert.ok(heading, 'heading was not imported');
  assert.equal(heading.text, 'Imported heading\nsecond line');
  assert.match(heading.color, /^#F4F4F5$/i);
  assert.equal(heading.bold, true);
  assert.equal(heading.italic, true);
  assert.equal(heading.size, 44);
  assert.equal(heading.align, 'center');
  assert.equal(heading.valign, 'middle');
  assert.ok(Math.abs(heading.x - 96) <= 2, `x ${heading.x}`);
  assert.ok(Math.abs(heading.y - 64) <= 2, `y ${heading.y}`);
  assert.ok(Math.abs(heading.w - 640) <= 2, `w ${heading.w}`);
  assert.ok(Math.abs(heading.h - 120) <= 2, `h ${heading.h}`);

  const rect = first.elements.find((el) => el.type === 'rect');
  assert.ok(rect, 'shape was not imported');
  assert.equal(rect.fill.toLowerCase(), '#16a34a');
  assert.equal(rect.radius, 12);
  assert.equal(rect.borderWidth, 3);

  assert.ok(first.elements.some((el) => el.type === 'ellipse'), 'ellipse was not imported');
  const image = first.elements.find((el) => el.type === 'image');
  assert.ok(image, 'image was not imported');
  assert.match(image.src, /^data:image\/png;base64,/);
  assert.equal(image.alt, 'pixel');

  // A deck 'line' is a filled rounded bar; PowerPoint has no equivalent filled
  // line, so the round-trip preserves it as a very thin rounded rectangle.
  const bar = second.elements.find((el) => el.y > 130 && el.y < 150 && el.h <= 10);
  assert.ok(bar, 'line bar was not imported');
  assert.equal(bar.fill.toLowerCase(), '#e11d48');
  assert.equal(second.transition.type, 'push');
});

test('PPTX import keeps non-16:9 slide sizes and multiple aspect ratios', async () => {
  const buffer = await deckToPptx(
    { filename: 'four-three.pptx' },
    { w: 960, h: 720, slides: [{ id: 's1', bg: '#ffffff', elements: [{ id: 't1', type: 'text', x: 100, y: 100, w: 400, h: 80, text: '4:3', size: 28, color: '#111111' }] }] },
    null,
  );
  const imported = await pptxToDeck(buffer);
  assert.equal(imported.content.w, 960);
  assert.equal(imported.content.h, 720);
  const text = imported.content.slides[0].elements.find((el) => el.type === 'text');
  assert.ok(Math.abs(text.x - 100) <= 2);
  assert.ok(Math.abs(text.w - 400) <= 2);
});

test('DOCX export mirrors editor typography, page geometry and native structures', async () => {
  const buffer = await docToDocx(
    { filename: 'fidelity.docx' },
    {
      header: 'Report header',
      footer: 'Confidential',
      html: [
        '<h1>Heading one</h1>',
        '<h2 style="text-align:center">Centred heading</h2>',
        '<p>Body <strong>bold</strong> and <em>italic</em> and <span style="color: rgb(225, 29, 72); background-color: #fef08a">highlighted</span>.</p>',
        '<ul><li>First</li><li>Second<ul><li>Nested</li></ul></li></ul>',
        '<ol><li>One</li><li>Two</li></ol>',
        '<blockquote>Quoted line</blockquote>',
        '<pre>const a = 1;\nconst b = 2;</pre>',
        '<table><thead><tr><th>Head</th><th>Other</th></tr></thead><tbody><tr><td><strong>Cell</strong></td><td>Value</td></tr></tbody></table>',
        `<figure data-align="center"><img src="${PNG_1X1}" alt="pixel"><figcaption>Caption</figcaption></figure>`,
        '<p><br></p>',
      ].join(''),
    },
    null,
  );

  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file('word/document.xml').async('string');
  const styles = await zip.file('word/styles.xml').async('string');
  const numbering = await zip.file('word/numbering.xml').async('string');

  assert.match(documentXml, /<w:pgSz w:w="12240" w:h="15840"[^>]*\/>/);
  assert.match(documentXml, /<w:pgMar w:top="780" w:right="600" w:bottom="780" w:left="600"/);
  assert.match(styles, /w:ascii="Arial"/);
  assert.match(styles, /<w:sz w:val="23"\/>/);
  assert.match(styles, /w:line="400" w:lineRule="atLeast"/);
  // Heading runs carry the editor's 30px (45 half-point) size, not Calibri.
  assert.match(documentXml, /<w:sz w:val="45"\/>/);
  assert.match(documentXml, /<w:b\/>/);
  assert.match(documentXml, /<w:i\/>/);
  assert.match(documentXml, /w:fill="FEF08A"/);
  assert.match(documentXml, /<w:color w:val="E11D48"\/>/);
  assert.match(documentXml, /<w:jc w:val="center"\/>/);
  // Native list numbering (bullet + decimal) rather than "1. " text prefixes.
  assert.match(numbering, /w:numFmt w:val="bullet"/);
  assert.match(numbering, /w:numFmt w:val="decimal"/);
  assert.match(numbering, /w:lvlText w:val="%1\."/);
  // Table borders, header shading and a fixed 736px column grid.
  assert.match(documentXml, /<w:tblBorders>/);
  assert.match(documentXml, /w:fill="EEF1F5"/);
  assert.match(documentXml, /<w:tblLayout w:type="fixed"\/>/);
  // Images are sized to the editor's 736px content column at natural ratio.
  assert.match(documentXml, /<wp:extent cx="\d+" cy="\d+"\/>/);
  // Header/footer text survives.
  const header = await zip.file('word/header1.xml').async('string');
  const footer = await zip.file('word/footer1.xml').async('string');
  assert.match(header, /Report header/);
  assert.match(footer, /Confidential/);
  // The editor's trailing empty paragraph must not create a blank final page.
  assert.ok(!/<w:t xml:space="preserve"><\/w:t>/.test(documentXml.slice(-400)), 'blank trailing paragraph');
});

// A hand-built package shaped like PowerPoint's own output: the slide relies on
// layout placeholders for position and inherited font sizes, and colours come
// from the theme (tx1/bg1) rather than explicit srgb values.
async function powerpointStylePptx() {
  const zip = new JSZip();
  const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

  zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>
<p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`);

  zip.file('ppt/slideMasters/slideMaster1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles>
</p:sldMaster>`);
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`);

  zip.file('ppt/theme/theme1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office"><a:themeElements>
<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>
<a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>
<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>
<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme>
</a:themeElements></a:theme>`);

  zip.file('ppt/slideLayouts/slideLayout1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout ${NS}><p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="10515600" cy="1325563"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></a:lstStyle><a:p><a:r><a:rPr lang="en-US"/></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content 2"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="838200" y="1825625"/><a:ext cx="10515600" cy="4351337"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr><a:defRPr sz="2800"/></a:lvl1pPr></a:lstStyle><a:p><a:r><a:rPr lang="en-US"/></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:sldLayout>`);
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`);

  zip.file('ppt/slides/slide1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${NS}><p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
<p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr><a:t>Real title</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr>
<p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>
<a:p><a:pPr lvl="0"><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr><a:r><a:rPr lang="en-US" dirty="0"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr><a:t>First point</a:t></a:r></a:p>
<a:p><a:pPr lvl="0"><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr><a:r><a:rPr lang="en-US" dirty="0"/><a:t>Second point</a:t></a:r></a:p>
</p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="4" name="Rectangle 3"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="914400" y="5486400"/><a:ext cx="1828800" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:style><a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Styled shape</a:t></a:r></a:p></p:txBody></p:sp>
<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="Table 4"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
<p:xfrm><a:off x="914400" y="4114800"/><a:ext cx="5486400" cy="914400"/></p:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>
<a:tblGrid><a:gridCol w="2743200"/><a:gridCol w="2743200"/></a:tblGrid>
<a:tr h="457200"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US"/><a:t>Head A</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US"/><a:t>Head B</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>
<a:tr h="457200"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US"/><a:t>Cell A</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US"/><a:t>Cell B</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>
</a:tbl></a:graphicData></a:graphic></p:graphicFrame>
</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
  zip.file('ppt/slides/_rels/slide1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`);

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

test('PowerPoint-style package inherits placeholder position, theme colours and layout text sizes', async () => {
  const buffer = await powerpointStylePptx();
  const imported = await pptxToDeck(buffer);
  const deck = imported.content;

  assert.equal(deck.w, 1280);
  assert.equal(deck.h, 720);
  assert.equal(deck.slides[0].bg, '#FFFFFF');

  const texts = deck.slides[0].elements.filter((el) => el.type === 'text');
  assert.equal(texts.length, 7); // title, body, p:style shape, and four table cells

  const title = texts.find((el) => el.text === 'Real title');
  assert.ok(title, 'title placeholder was not imported');
  assert.equal(title.size, 59); // 44pt from the layout/default text style
  assert.equal(title.color.toUpperCase(), '#000000'); // tx1 → dk1
  assert.ok(Math.abs(title.x - 98) <= 2, `title x ${title.x}`); // 88 + 9.6px inset
  assert.ok(Math.abs(title.y - 43) <= 2, `title y ${title.y}`);
  assert.ok(Math.abs(title.w - (10515600 / 9525 - 19.2)) <= 3, `title w ${title.w}`);

  const body = texts.find((el) => el.text.includes('First point'));
  assert.ok(body, 'body placeholder was not imported');
  assert.equal(body.size, 37); // 28pt from the layout
  assert.match(body.text, /^• First point\n• Second point$/);

  // Shapes styled through <p:style> (how PowerPoint writes inserted shapes)
  // must keep their theme fill, border and fontRef text colour.
  const styled = deck.slides[0].elements.find((el) => el.type === 'rect');
  assert.ok(styled, 'p:style shape was not imported');
  assert.equal(styled.fill, '#4472C4');
  assert.match(styled.borderColor, /^#[0-9A-F]{6}$/); // lnRef theme colour, shade applied
  const styledText = deck.slides[0].elements.find((el) => el.text === 'Styled shape');
  assert.ok(styledText, 'p:style shape text was not imported');
  assert.equal(styledText.color, '#FFFFFF');

  // Tables become editable text boxes over cell rectangles, keeping the grid.
  for (const label of ['Head A', 'Head B', 'Cell A', 'Cell B']) {
    assert.ok(deck.slides[0].elements.some((el) => el.text === label), `table cell ${label} missing`);
  }
  const headerCell = deck.slides[0].elements.find((el) => el.text === 'Head A');
  assert.ok(Math.abs(headerCell.x - (96 + 6)) <= 2, `table cell x ${headerCell.x}`);
  assert.ok(Math.abs(headerCell.y - (432 + 4)) <= 2, `table cell y ${headerCell.y}`);
});
