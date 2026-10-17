"""Preserve public gallery files, record integrity, and build a static archive."""
from __future__ import annotations

import concurrent.futures
import hashlib
import io
import json
import threading
import time
import zipfile
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit

import requests
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'https://reactor-prompts-magazine.pages.dev'
LEGACY = 'https://reactor.manus.space'
LOCAL = threading.local()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.part')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    temp.replace(path)


def safe_path(value):
    if not isinstance(value, str) or not value.startswith('/'):
        raise ValueError('Unsafe source path')
    p = PurePosixPath(value)
    if ('..' in p.parts or '\\' in value or ':' in value or '\x00' in value
            or urlsplit(value).netloc or len(p.parts) < 3
            or p.parts[1] not in ('gallery-images', 'gallery-thumbnails', 'manus-storage')
            or any(part.endswith((' ', '.')) for part in p.parts[1:])):
        raise ValueError('Unsafe source path')
    relative = str(p).lstrip('/')
    base = (ROOT / 'originals').resolve()
    if not (base / relative).resolve().is_relative_to(base):
        raise ValueError('Source path escapes archive directory')
    return relative


def load_progress(log):
    """Recover a torn final append, and retry incomplete or transient records."""
    if not log.exists():
        return {}
    raw_lines = log.read_bytes().splitlines(keepends=True)
    records = []
    valid_bytes = 0
    for index, raw_line in enumerate(raw_lines):
        try:
            record = json.loads(raw_line)
        except (json.JSONDecodeError, UnicodeDecodeError):
            if index != len(raw_lines) - 1:
                raise ValueError('Corrupt progress record before end of log')
            with log.open('r+b') as stream:
                stream.truncate(valid_bytes)
            break
        safe_path(record['path'])
        records.append(record)
        valid_bytes += len(raw_line)
    if log.stat().st_size and not log.read_bytes().endswith(b'\n'):
        with log.open('ab') as stream:
            stream.write(b'\n')
    completed = {}
    for record in records:
        if record['status'] == 'missing' and record.get('http_status') in (404, 410):
            completed[record['path']] = record
        elif record['status'] == 'ok':
            original = ROOT / 'originals' / safe_path(record['path'])
            preview = ROOT / 'previews' / (hashlib.sha256(record['path'].encode('utf-8')).hexdigest()[:24] + '.webp')
            try:
                if original.stat().st_size != record['bytes']:
                    continue
                with Image.open(preview) as image:
                    image.load()
                completed[record['path']] = record
            except (OSError, ValueError):
                pass
    return completed


def validate_paths(paths):
    destinations = {}
    for path in paths:
        identity = safe_path(path).casefold()
        if identity in destinations and destinations[identity] != path:
            raise ValueError('Source paths collide on Windows: ' + path)
        destinations[identity] = path


def session():
    if not hasattr(LOCAL, 'session'):
        LOCAL.session = requests.Session()
    return LOCAL.session


def download(path):
    relative = safe_path(path)
    url = (LEGACY if path.startswith('/manus-storage/') else SOURCE) + path
    dest = ROOT / 'originals' / relative
    result = {'path': path, 'source_url': url}
    try:
        if dest.exists():
            payload = dest.read_bytes()
        else:
            for attempt in range(3):
                response = session().get(url, timeout=(15, 60))
                if response.status_code in (429, 500, 502, 503, 504) and attempt < 2:
                    time.sleep(2 ** (attempt + 1))
                    continue
                break
            if response.status_code != 200:
                status = 'missing' if response.status_code in (404, 410) else 'error'
                return {**result, 'status': status, 'http_status': response.status_code}
            if not response.headers.get('Content-Type', '').startswith('image/'):
                return {**result, 'status': 'error', 'reason': 'Non-image response'}
            payload = response.content
        with Image.open(io.BytesIO(payload)) as image:
            image.verify()
        if not dest.exists():
            dest.parent.mkdir(parents=True, exist_ok=True)
            temp = dest.with_suffix(dest.suffix + '.part')
            temp.write_bytes(payload)
            temp.replace(dest)
        digest = hashlib.sha256(payload).hexdigest()
        preview_name = hashlib.sha256(path.encode('utf-8')).hexdigest()[:24] + '.webp'
        preview = ROOT / 'previews' / preview_name
        valid_preview = False
        if preview.exists():
            try:
                with Image.open(preview) as image:
                    image.load()
                valid_preview = True
            except (OSError, ValueError):
                pass
        if not valid_preview:
            with Image.open(io.BytesIO(payload)) as image:
                image = ImageOps.exif_transpose(image).convert('RGB')
                image.thumbnail((960, 960))
                for quality in (65, 50, 35):
                    output = io.BytesIO()
                    image.save(output, format='WEBP', quality=quality, method=4)
                    if output.tell() <= 40000:
                        break
                if output.tell() > 55000:
                    image.thumbnail((640, 640))
                    output = io.BytesIO()
                    image.save(output, format='WEBP', quality=40, method=4)
                preview.parent.mkdir(parents=True, exist_ok=True)
                temp = preview.with_suffix('.webp.part')
                temp.write_bytes(output.getvalue())
                temp.replace(preview)
        return {**result, 'status': 'ok', 'bytes': len(payload), 'sha256': digest,
                'preview': 'previews/' + preview_name, 'preview_bytes': preview.stat().st_size}
    except Exception as error:
        return {**result, 'status': 'error', 'reason': str(error)}


def main():
    data = json.loads((ROOT / 'source/gallery-data.json').read_text(encoding='utf-8'))
    paths = sorted({path for post in data['posts'] for path in post['images']} |
                   {post['thumbnail'] for post in data['posts'] if post.get('thumbnail')})
    validate_paths(paths)
    log = ROOT / 'download-log.jsonl'
    completed = load_progress(log)
    pending = [p for p in paths if p not in completed]
    start = time.monotonic()
    with log.open('a', encoding='utf-8') as stream, concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        jobs = {pool.submit(download, p): p for p in pending}
        for future in concurrent.futures.as_completed(jobs):
            result = future.result()
            completed[result['path']] = result
            stream.write(json.dumps(result, ensure_ascii=False) + '\n')
            stream.flush()
            if len(completed) % 250 == 0 or len(completed) == len(paths):
                count = sum(r['status'] == 'ok' for r in completed.values())
                size = sum(r.get('bytes', 0) for r in completed.values())
                print(f'{len(completed)}/{len(paths)} checked; {count} saved; {size / 2**30:.2f} GiB; {time.monotonic()-start:.0f}s', flush=True)
    records = [completed[path] for path in paths]
    missing = [r for r in records if r['status'] != 'ok']
    write_json(ROOT / 'missing-images.json', missing)
    errors = [r for r in records if r['status'] == 'error']
    if errors:
        write_json(ROOT / 'migration-errors.json', errors)
        print(f'STOP: {len(errors)} transient/processing errors require retry', flush=True)
        raise SystemExit(1)
    assets = ROOT / 'release-assets'
    assets.mkdir(exist_ok=True)
    archives = []
    current = None
    current_size = 0
    try:
        for record in records:
            if record['status'] != 'ok':
                continue
            if current is None or current_size + record['bytes'] > 900 * 2**20:
                if current is not None:
                    current.close()
                name = f'original-images-{len(archives)+1:02d}.zip'
                archives.append(name)
                current = zipfile.ZipFile(assets / name, 'w', compression=zipfile.ZIP_STORED)
                current_size = 0
                print('Packing ' + name, flush=True)
            relative = safe_path(record['path'])
            current.write(ROOT / 'originals' / relative, relative)
            current_size += record['bytes']
            record['archive'] = archives[-1]
    finally:
        if current is not None:
            current.close()
    write_json(ROOT / 'image-manifest.json', records)
    image_paths = {p for post in data['posts'] for p in post['images']}
    stats = {
        'source': SOURCE, 'snapshot_date': '2026-10-17', 'posts': len(data['posts']),
        'posts_with_prompt': sum(bool(p.get('prompt')) for p in data['posts']),
        'image_references': sum(len(p['images']) for p in data['posts']),
        'unique_images': len(image_paths), 'unique_files_including_thumbnails': len(paths),
        'saved_images': sum(r['status'] == 'ok' and r['path'] in image_paths for r in records),
        'saved_files_including_thumbnails': len(records) - len(missing),
        'missing_images': sum(r['status'] != 'ok' and r['path'] in image_paths for r in records),
        'missing_files_including_thumbnails': len(missing),
        'original_bytes': sum(r.get('bytes', 0) for r in records),
        'preview_bytes': sum(r.get('preview_bytes', 0) for r in records),
        'archives': []
    }
    for name in archives:
        path = assets / name
        with path.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        stats['archives'].append({'name': name, 'bytes': path.stat().st_size, 'sha256': digest})
    write_json(ROOT / 'migration-summary.json', stats)
    gallery = []
    lookup = {r['path']: r for r in records}
    for post in data['posts']:
        images = [{**lookup[path]} for path in post['images']]
        thumb = lookup.get(post.get('thumbnail'), {})
        fallback = next((image['preview'] for image in images if image['status'] == 'ok'), '')
        gallery.append({**post, 'images': images, 'thumbnail': thumb.get('preview', fallback)})
    write_json(ROOT / 'gallery.json', {'posts': gallery, 'categories': data['categories'], 'summary': stats})
    write_json(ROOT / 'prompts.json', [{'id': p['id'], 'caption': p.get('caption', ''), 'prompt': p.get('prompt', ''), 'tags': p.get('tags', []), 'source': p.get('threadsUrl', '')} for p in data['posts']])
    print(json.dumps(stats, ensure_ascii=True, indent=2), flush=True)


if __name__ == '__main__':
    main()
