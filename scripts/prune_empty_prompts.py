"""Recover source-language prompts, then prune empty cards and exclusive previews.

Dry run by default. --apply writes an ignored local backup before removing files.
Raw source snapshots, PC application data and shared release ZIPs are not modified.
"""
import argparse
from collections import Counter
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil

from import_studio import extract_args
from prompt_content import source_prompt

ROOT = Path(__file__).resolve().parents[1]
CATALOG = 'library/catalog.json'
CHUNK = re.compile(r'library/details/(\d{3})-[a-f0-9]{10}\.json\Z')
PREVIEW = re.compile(r'(?:library/)?previews/[a-f0-9]{24}\.webp\Z')

def owned(relative):
    path = (ROOT / relative).resolve()
    if not path.is_relative_to(ROOT) or path == ROOT:
        raise ValueError('Path outside project: ' + relative)
    return path

def read(relative):
    return json.loads(owned(relative).read_text(encoding='utf-8'))

def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')

def references(cards, details):
    paths = set()
    for card in cards:
        values = [card.get('thumbnail', '')] + [image.get('preview', '') for image in details[card['id']]['images']]
        for relative in values:
            if not relative:
                continue
            if not PREVIEW.fullmatch(relative):
                raise ValueError('Unexpected preview path: ' + relative)
            owned(relative)
            paths.add(relative)
    return paths

def plan():
    catalog = read(CATALOG)
    cards = catalog['cards']
    if len({c['id'] for c in cards}) != len(cards):
        raise ValueError('Duplicate card IDs')
    original_chunks = {}
    details = {}
    for name in sorted({card['chunk'] for card in cards}):
        if not CHUNK.fullmatch(name):
            raise ValueError('Unexpected detail path: ' + name)
        original_chunks[name] = read(name)
        details.update(original_chunks[name])
    if set(details) != {c['id'] for c in cards}:
        raise ValueError('Catalog/detail membership mismatch')
    original_details = deepcopy(details)
    before_refs = references(cards, details)
    posts = {str(post['id']): post for post in read('source/gallery-data.json')['posts']}
    studio = {post['id']: post for post in read('output/studio-source/source.json')['prompts']}
    translations = read('source/translations.json')
    recovered, removed, kept = [], [], []
    for card in cards:
        detail = details[card['id']]
        content = detail.get('content')
        if not isinstance(content, str):
            raise ValueError('Unexpected prompt type: ' + card['id'])
        if not content.strip():
            if card['origin'] == 'reactor':
                post = posts[card['id'].removeprefix('reactor:')]
                content, from_translation = source_prompt(post, translations)
                if content:
                    detail['content'] = content
                    detail['args'] = extract_args(content, [])
                    detail['promptSource'] = 'translations:ko' if from_translation else 'gallery-data:prompt'
                    recovered.append({'id': card['id'], 'source': detail['promptSource']})
            elif card['origin'] == 'studio':
                original = studio[card['id'].removeprefix('studio:')].get('content')
                if isinstance(original, str) and original.strip():
                    raise ValueError('Prompt exists in Studio source: ' + card['id'])
            else:
                raise ValueError('Unknown card origin')
        if not content.strip():
            removed.append(card)
            continue
        card['hasPrompt'] = True
        card['variables'] = len(detail['args'])
        kept.append(card)
    if not removed and not recovered:
        return None
    after_refs = references(kept, details)
    deleted_previews = sorted(before_refs - after_refs)
    # Check every surviving path before any writes or deletions.
    for name in after_refs:
        if not owned(name).is_file():
            raise ValueError('Missing retained preview: ' + name)
    for card in kept:
        if card['id'] not in {r['id'] for r in recovered} and details[card['id']] != original_details[card['id']]:
            raise ValueError('Existing prompt detail changed: ' + card['id'])
    writes, deletes = {}, []
    by_chunk = {}
    for card in kept:
        by_chunk.setdefault(card['chunk'], []).append(card)
    for old_name, old_data in original_chunks.items():
        chunk_cards = by_chunk.get(old_name, [])
        new_data = {card['id']: details[card['id']] for card in chunk_cards}
        if new_data == old_data:
            continue
        deletes.append(old_name)
        if not chunk_cards:
            continue
        data = encode(new_data)
        prefix = CHUNK.fullmatch(old_name)[1]
        new_name = f'library/details/{prefix}-{hashlib.sha256(data).hexdigest()[:10]}.json'
        if owned(new_name).exists() and owned(new_name).read_bytes() != data:
            raise ValueError('Chunk name collision: ' + new_name)
        writes[new_name] = data
        for card in chunk_cards:
            card['chunk'] = new_name
    removed_bytes = sum(owned(name).stat().st_size for name in deleted_previews)
    summary = catalog['summary']
    summary.setdefault('reactorSourceCards', summary['reactorCards'])
    counts = Counter(card['category'] for card in kept)
    summary.update(version='2026-10-17-notebook-5', totalCards=len(kept), promptCards=len(kept),
                   reactorCards=sum(c['origin'] == 'reactor' for c in kept),
                   studioImportedCards=sum(c['origin'] == 'studio' for c in kept),
                   cardsWithoutImage=sum(not c['thumbnail'] for c in kept), categoryCounts=dict(counts),
                   emptyPromptCardsRemoved=len(removed), translationPromptsRecovered=len(recovered),
                   exclusivePreviewFilesRemoved=len(deleted_previews), exclusivePreviewBytesRemoved=removed_bytes)
    catalog['version'] = summary['version']
    catalog['cards'] = kept
    for category in catalog['categories']:
        category['count'] = counts[category['id']]
    report = {'version': summary['version'], 'beforeCards': len(cards), 'remainingCards': len(kept),
              'removedEmptyCards': len(removed), 'removedByOrigin': dict(Counter(c['origin'] for c in removed)),
              'recoveredPrompts': recovered, 'removedIDs': [c['id'] for c in removed],
              'exclusivePreviewFilesRemoved': len(deleted_previews), 'exclusivePreviewBytesRemoved': removed_bytes,
              'sourceFinding': 'Empty gallery prompt fields were cross-checked against the source and separate language data; Studio snapshot content was also empty.',
              'archivePolicy': 'Raw source snapshots and original release ZIPs are historical archives and unchanged.'}
    writes[CATALOG] = encode(catalog)
    writes['library/import-report.json'] = encode(summary)
    writes['library/prompt-cleanup-report.json'] = encode(report)
    deletes.extend(deleted_previews)
    return writes, deletes, report

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    result = plan()
    if result is None:
        print(json.dumps({'changed': False, 'reason': 'No empty cards remain'}))
        return
    writes, deletes, report = result
    if args.apply:
        backup = owned('output/prompt-cleanup-backup/' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
        backup.mkdir(parents=True)
        for relative in sorted(set(writes) | set(deletes)):
            source = owned(relative)
            if source.exists():
                target = (backup / relative).resolve()
                if not target.is_relative_to(backup):
                    raise ValueError('Backup path escaped')
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
        (backup / 'manifest.json').write_bytes(encode({'writes': list(writes), 'deletes': deletes, 'report': report}))
        for relative, data in writes.items():
            target = owned(relative)
            temporary = target.with_suffix(target.suffix + '.part')
            temporary.write_bytes(data)
            temporary.replace(target)
        for relative in deletes:
            if relative in writes or not (CHUNK.fullmatch(relative) or PREVIEW.fullmatch(relative)):
                raise ValueError('Unsafe deletion: ' + relative)
            owned(relative).unlink()
    print(json.dumps({**{k: v for k, v in report.items() if k not in ('removedIDs', 'sourceFinding', 'archivePolicy')},
                      'apply': args.apply, 'filesWritten': len(writes), 'filesDeleted': len(deletes)}, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
