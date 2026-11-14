"""Build the shareable PDF from the maintained Markdown guide.

Requires reportlab and pypdf in a documentation environment, not the app runtime.
Run from the repository root. The project Conda environment need not be changed.
"""
from pathlib import Path
import re
from html import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
    Preformatted, KeepTogether,
)
from reportlab.platypus.tableofcontents import TableOfContents
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs/PROJECT_DOCUMENTATION.md'
OUTPUT = ROOT / 'output/pdf/SafeRoute_Gujarat_Project_Documentation.pdf'
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
FONT, BOLD = 'Helvetica', 'Helvetica-Bold'
font_dir = Path('C:/Windows/Fonts')
if (font_dir/'arial.ttf').exists():
    pdfmetrics.registerFont(TTFont('Guide', str(font_dir/'arial.ttf')))
    pdfmetrics.registerFont(TTFont('GuideBold', str(font_dir/'arialbd.ttf')))
    pdfmetrics.registerFontFamily('Guide',normal='Guide',bold='GuideBold',italic='Guide',boldItalic='GuideBold')
    FONT, BOLD = 'Guide', 'GuideBold'

NAVY = colors.HexColor('#17354b')
BLUE = colors.HexColor('#256c9c')
TEAL = colors.HexColor('#197665')
GRAY = colors.HexColor('#53636e')
STYLES = getSampleStyleSheet()
STYLES.add(ParagraphStyle('BodyGuide', fontName=FONT, fontSize=10, leading=14,
                        textColor=NAVY, spaceAfter=7, splitLongWords=True))
STYLES.add(ParagraphStyle('ChapterGuide', fontName=BOLD, fontSize=17, leading=21,
                        textColor=BLUE, spaceBefore=18, spaceAfter=11, keepWithNext=True))
STYLES.add(ParagraphStyle('SubGuide', fontName=BOLD, fontSize=12, leading=16,
                        textColor=TEAL, spaceBefore=12, spaceAfter=7, keepWithNext=True))
STYLES.add(ParagraphStyle('CellGuide',fontName=FONT,fontSize=8.3,leading=11.2,textColor=NAVY))
STYLES.add(ParagraphStyle('CellHeadGuide',fontName=BOLD,fontSize=8.3,leading=11.2,textColor=colors.white))
STYLES.add(ParagraphStyle('CodeGuide',fontName='Courier',fontSize=8.2,leading=11,
                        backColor=colors.HexColor('#f0f4f6'),borderPadding=9,spaceBefore=5,spaceAfter=13))
STYLES.add(ParagraphStyle('ListGuide',parent=STYLES['BodyGuide'],leftIndent=14,firstLineIndent=0,spaceAfter=6))


def inline(value):
    text = escape(value)
    text = re.sub(r'`([^`]+)`',r'<font name="Courier" size="8.2">\1</font>',text)
    text = re.sub(r'\*\*(.+?)\*\*',r'<b>\1</b>',text)
    text = re.sub(r'(?<!\*)\*([^*]+)\*(?!\*)',r'<i>\1</i>',text)
    text = re.sub(r'(?<!["=])(https?://[^\s<>]+)',r'<link href="\1" color="#256c9c">\1</link>',text)
    return text


class GuideDoc(SimpleDocTemplate):
    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph) and flowable.style.name == 'ChapterGuide':
            title = flowable.getPlainText()
            if not title[:1].isdigit():
                return
            key = 'chapter-' + re.sub(r'\W+', '-',title)
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(title,key,0)
            self.notify('TOCEntry',(0,title,self.page,key))


def page(canvas, doc):
    canvas.saveState()
    width, height = A4
    if doc.page > 1:
        canvas.setFillColor(GRAY);canvas.setFont(FONT,8)
        canvas.drawString(19*mm,height-13*mm,'SAFEROUTE GUJARAT  /  PROJECT DOCUMENTATION')
        canvas.setStrokeColor(colors.HexColor('#d8e1e6'))
        canvas.line(19*mm,height-16*mm,width-19*mm,height-16*mm)
    canvas.setFillColor(GRAY);canvas.setFont(FONT,8)
    canvas.drawString(19*mm,12*mm,'14 November 2026  |  Academic safety-routing prototype')
    canvas.drawRightString(width-19*mm,12*mm,str(doc.page))
    canvas.restoreState()


doc = GuideDoc(str(OUTPUT),pagesize=A4,rightMargin=19*mm,leftMargin=19*mm,
               topMargin=23*mm,bottomMargin=21*mm,title='SafeRoute Gujarat - Complete Project Documentation',
               author='SafeRoute Gujarat Project Team',subject='Implementation, safety model, data, location, verification and deployment')
story=[]
cover_title = ParagraphStyle('CoverTitle',fontName=BOLD,fontSize=36,leading=42,textColor=NAVY,spaceAfter=18)
cover_sub = ParagraphStyle('CoverSub',fontName=FONT,fontSize=18,leading=25,textColor=BLUE,spaceAfter=20)
story += [Spacer(1,29*mm),Paragraph('SAFETY-FOCUSED ROUTE PLANNING',STYLES['SubGuide']),
          Paragraph('SafeRoute<br/>Gujarat',cover_title),Paragraph('Complete project documentation<br/>and explanation',cover_sub),
          Paragraph('SVNIT<br/>Project supervisor: Prof. Shriniwas Arkatkar',STYLES['BodyGuide']),Spacer(1,10*mm),
          Paragraph('14 November 2026',STYLES['BodyGuide']),
          Paragraph(inline('https://route-optimization-safety.vercel.app'),STYLES['BodyGuide']),
          Paragraph(inline('https://github.com/ArnavB11/Route-Optimization---Safety-'),STYLES['BodyGuide']),
          Paragraph('Reviewed software baseline: adc94a5',STYLES['BodyGuide']),
          Spacer(1,17*mm),Paragraph('Purpose',STYLES['SubGuide']),
          Paragraph('A practical explanation for students, evaluators and maintainers: the safety objective, implemented architecture, route calculations, professor-supplied recordings, location arrow, tests and deployment.',STYLES['BodyGuide']),
          Spacer(1,6*mm),Paragraph('<b>Read every safety result as a model estimate.</b> Simulation and software checks do not demonstrate a reduction in real crashes. Physical-phone GPS movement remains unverified.',STYLES['BodyGuide']),PageBreak()]
story.append(Paragraph('Reading guide',STYLES['ChapterGuide']))
story.append(Paragraph('Start with the overview and user workflow. Sections 4-8 explain the evidence, safety calculation, route search and location behaviour. Sections 9-13 support implementation review, operation and demonstration.',STYLES['BodyGuide']))
toc=TableOfContents()
toc.levelStyles=[ParagraphStyle('TOCGuide',fontName=FONT,fontSize=10,leading=15,leftIndent=0,firstLineIndent=0,spaceBefore=6,textColor=NAVY)]
story += [toc,PageBreak()]
lines=SOURCE.read_text(encoding='utf-8').splitlines()
i=next(i for i,line in enumerate(lines) if line.startswith('## 1.'))
while i<len(lines):
    line=lines[i].strip()
    if not line: i+=1;continue
    if line.startswith('```'):
        code=[];i+=1
        while i<len(lines) and not lines[i].startswith('```'):
            code.append(lines[i]);i+=1
        story.append(KeepTogether([Preformatted('\n'.join(code),STYLES['CodeGuide'])]));i+=1;continue
    if line.startswith('### '):
        story.append(Paragraph(inline(line[4:]),STYLES['SubGuide']));i+=1;continue
    if line.startswith('## '):
        story.append(Paragraph(inline(line[3:]),STYLES['ChapterGuide']));i+=1;continue
    if line.startswith('|'):
        rows=[]
        while i<len(lines) and lines[i].strip().startswith('|'):
            cells=[c.strip() for c in lines[i].strip().strip('|').split('|')]
            if not all(re.fullmatch(r'[:\- ]+',c) for c in cells): rows.append(cells)
            i+=1
        n=len(rows[0]);width=doc.width
        ratios={2:[.39,.61],3:[.25,.31,.44],4:[.34,.22,.22,.22],5:[.40,.15,.15,.15,.15]}.get(n,[1/n]*n)
        data=[[Paragraph(inline(c),STYLES['CellHeadGuide' if r==0 else 'CellGuide']) for c in row] for r,row in enumerate(rows)]
        table=Table(data,colWidths=[width*v for v in ratios],repeatRows=1,hAlign='LEFT',rowSplitRange=(3,-1))
        table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),NAVY),('VALIGN',(0,0),(-1,-1),'TOP'),
                ('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.HexColor('#f0f4f6'),colors.white]),
                ('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),
                ('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),
                ('LINEBELOW',(0,0),(-1,0),.5,NAVY)]))
        story += [table,Spacer(1,10)];continue
    match=re.match(r'^(\d+)\.\s+(.+)$',line)
    if match or line.startswith('- '):
        text=match.group(2) if match else line[2:]
        story.append(Paragraph(inline(text),STYLES['ListGuide'],bulletText=match.group(1)+'.' if match else '-'))
        i+=1;continue
    paragraph=[line];i+=1
    while i<len(lines) and lines[i].strip() and not lines[i].startswith(('#','|','```','- ')) and not re.match(r'^\d+\. ',lines[i]):
        paragraph.append(lines[i].strip());i+=1
    following = next((item.strip() for item in lines[i:] if item.strip()), '')
    style = ParagraphStyle('LeadGuide',parent=STYLES['BodyGuide'],keepWithNext=True) if following.startswith(('|','```')) else STYLES['BodyGuide']
    flow = Paragraph(inline(' '.join(paragraph)),style)
    story.append(flow)

doc.multiBuild(story,onFirstPage=page,onLaterPages=page)
reader=PdfReader(OUTPUT)
texts=[p.extract_text() or '' for p in reader.pages]
assert len(texts)>=8 and all(text.strip() for text in texts)
assert '13. Maintenance checklist' in '\n'.join(texts)
assert 'Physical-phone GPS movement remains unverified' in texts[0]
print(f'{OUTPUT}\nPages: {len(reader.pages)}\nBytes: {OUTPUT.stat().st_size}')
