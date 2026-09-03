import json
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


DOCX = Path('artifacts/t-328-word/word-roundtrip-exported.docx')
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
PKG = '{http://schemas.openxmlformats.org/package/2006/relationships}'


with zipfile.ZipFile(DOCX) as archive:
    bad = archive.testzip()
    document = ET.fromstring(archive.read('word/document.xml'))
    relationships = ET.fromstring(archive.read('word/_rels/document.xml.rels'))
    footer = ET.fromstring(archive.read('word/footer1.xml'))
    text = ''.join(node.text or '' for node in document.iter(f'{W}t'))
    footer_text = ''.join(node.text or '' for node in footer.iter(f'{W}t'))
    styles = [node.attrib.get(f'{W}val') for node in document.iter(f'{W}pStyle')]
    tables = list(document.iter(f'{W}tbl'))
    table_rows = list(tables[0].iter(f'{W}tr'))
    cells = [[ ''.join(node.text or '' for node in cell.iter(f'{W}t')) for cell in row.findall(f'{W}tc') ] for row in table_rows]
    drawings = list(document.iter(f'{W}drawing'))
    hyperlinks = list(document.iter(f'{W}hyperlink'))
    link_id = hyperlinks[0].attrib[f'{R}id']
    link_target = next(item.attrib['Target'] for item in relationships.findall(f'{PKG}Relationship') if item.attrib['Id'] == link_id)
    image_parts = [name for name in archive.namelist() if name.startswith('word/media/')]
    report = {
        'zipIntegrity': bad is None,
        'bodySentinels': {marker: text.count(marker) for marker in ['LH-OFFICE-V1-DOC-H1', 'T-328-PASTE', '中文保真检查 ✅ — edited', 'LH-OFFICE-V1-DOC-END']},
        'headingStyles': styles,
        'listNumberCount': styles.count('ListNumber'),
        'listBulletCount': styles.count('ListBullet'),
        'table': {'dimensions': [len(cells), len(cells[0])], 'cells': cells},
        'imageCount': len(drawings),
        'imageParts': image_parts,
        'imageAltPresent': 'LH-OFFICE-V1-IMAGE-ALT' in archive.read('word/document.xml').decode('utf-8'),
        'hyperlink': {'displayText': ''.join(node.text or '' for node in hyperlinks[0].iter(f'{W}t')), 'target': link_target},
        'footerText': footer_text,
        'pageFieldPresent': 'PAGE' in archive.read('word/footer1.xml').decode('utf-8'),
    }

assert report['zipIntegrity']
assert all(value == 1 for value in report['bodySentinels'].values())
assert report['listNumberCount'] == 4 and report['listBulletCount'] == 2
assert report['table']['dimensions'] == [3, 3] and report['table']['cells'][2] == ['Export', 'Bo', 'Ready']
assert report['imageCount'] == 1 and report['imageAltPresent']
assert report['hyperlink'] == {'displayText': 'LobeHub repository', 'target': 'https://github.com/lobehub/lobehub'}
assert 'LH-OFFICE-V1-DOC-FOOTER' in report['footerText'] and report['pageFieldPresent']
print(json.dumps(report, ensure_ascii=False, indent=2))
