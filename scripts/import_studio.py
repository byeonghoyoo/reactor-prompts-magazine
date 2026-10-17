"""Read-only import of the PromptStudio snapshot/cache into a static notebook."""
import hashlib, io, json, re, sys, unicodedata, zipfile
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from PIL import Image, ImageOps
from prompt_content import source_prompt

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path('C:/Users/metic/AppData/Local/PromptStudio')
OUT = ROOT / 'library'
RELEASE = 'https://github.com/byeonghoyoo/reactor-prompts-magazine/releases/download/promptstudio-2026-10-17/'
GROUPS = [('people','인물과 패션'),('marketing','광고와 브랜딩'),('content','콘텐츠와 아트'),('business','업종별 디자인'),('space','공간과 디지털'),('life','일상과 사진')]
CATEGORIES = [
 ('profile-avatar','프로필 · 인물','people'),('fashion-editorial','패션 · 화보','people'),('selfie-daily','셀카 · 일상 인물','people'),('biz-wedding','웨딩 · 커플','people'),
 ('ad-poster','광고 · 포스터','marketing'),('product-marketing','제품 마케팅','marketing'),('ecommerce','제품 사진 · 쇼핑몰','marketing'),('brand-design','브랜드 · 로고','marketing'),('goods-mockup','굿즈 · 목업','marketing'),
 ('sns-card','SNS · 카드뉴스','content'),('infographic','인포그래픽 · 도표','content'),('youtube-thumbnail','유튜브 썸네일','content'),('comic-illustration','만화 · 일러스트','content'),('character-toy','캐릭터 · 피규어','content'),
 ('biz-beauty','뷰티 · 클리닉','business'),('biz-food','음식 · 카페','business'),('biz-fitness','운동 · 피트니스','business'),('biz-education','교육 · 학습','business'),('biz-pet','반려동물','business'),
 ('biz-realestate','인테리어 · 건축','space'),('landscape-travel','풍경 · 여행','space'),('app-web-ui','앱 · 웹 디자인','space'),('game-asset','게임 · 디지털 에셋','space'),
 ('photo-edit','사진 편집 · 복원','life'),('season-event','기념일 · 시즌','life'),('hobby-life','취미 · 라이프','life'),('others','기타 아이디어','life')]
RULES = {
 'biz-beauty':r'피부과|성형외과|클리닉|리프팅|뷰티|화장품|스킨케어|\b(?:skincare|cosmetic|beauty clinic|dermatology|makeup)\b',
 'biz-food':r'음식|카페|메뉴|레시피|디저트|커피|케이크|보쌈|\b(?:food|cafe|café|menu|recipe|dessert|coffee|bakery|restaurant)\b',
 'biz-fitness':r'헬스|피트니스|요가|복싱|체육관|운동복|\b(?:fitness|gym|yoga|boxing|workout)\b',
 'biz-education':r'학습|학원|교육|수업|교재|\b(?:education|classroom|learning|worksheet|textbook)\b',
 'biz-pet':r'반려|강아지|고양이|애완|\b(?:pet|pets|dog|dogs|cat|cats|puppy|kitten)\b',
 'biz-wedding':r'웨딩|결혼|신부|커플|신혼|\b(?:wedding|bride|bridal|couple|newlywed)\b',
 'character-toy':r'피규어|스티커|봉제|인형|키링|치비|\b(?:figurine|action figure|toy|plush|sticker|chibi|keychain)\b',
 'brand-design':r'로고|브랜딩|브랜드 가이드|\b(?:logo|brand identity|brand guide|brand book|branding)\b',
 'infographic':r'인포그래픽|다이어그램|도표|분해도|\b(?:infographic|diagram|flowchart|exploded view|data visualization)\b',
 'youtube-thumbnail':r'썸네일|유튜브|\b(?:youtube|thumbnail)\b',
 'comic-illustration':r'만화|웹툰|애니메|일러스트|수채화|\b(?:comic|manga|anime|illustration|watercolor|storybook)\b',
 'app-web-ui':r'웹사이트|랜딩페이지|앱 디자인|웹 디자인|대시보드|\b(?:website|landing page|dashboard|user interface|app ui|web design|mobile app)\b',
 'game-asset':r'게임|픽셀아트|\b(?:game asset|video game|pixel art|game ui|sprite)\b',
 'biz-realestate':r'인테리어|건축|부동산|평면도|\b(?:interior|architecture|architectural|floor plan|real estate|living room|bedroom)\b',
 'landscape-travel':r'풍경|여행|관광|도시 전경|\b(?:landscape|travel|tourism|cityscape|scenery|panorama)\b',
 'photo-edit':r'사진 복원|사진 변환|고화질|색상 복원|\b(?:photo restoration|restore.*photo|photo edit|colorize|upscale|image restoration)\b',
 'fashion-editorial':r'패션|화보|한복|스타일링|\b(?:fashion|couture|editorial|runway|lookbook|outfit)\b',
 'selfie-daily':r'셀카|일상미|\b(?:selfie|mirror shot|candid snapshot)\b',
 'season-event':r'크리스마스|할로윈|발렌타인|어버이날|추석|설날|생일|\b(?:christmas|halloween|valentine|new year|birthday)\b',
 'goods-mockup':r'목업|굿즈|\b(?:mockup|merchandise|t-shirt design|tote bag)\b',
 'sns-card':r'카드뉴스|SNS|소셜|인스타그램|\b(?:social media|instagram|carousel|social post)\b',
 'ecommerce':r'제품컷|누끼|쇼핑몰|제품 사진|\b(?:ecommerce|e-commerce|product photography|product photo|packshot)\b',
 'product-marketing':r'제품 광고|상품 광고|제품 포스터|\b(?:product ad|product campaign|product poster|product marketing)\b',
 'ad-poster':r'포스터|광고|전단|\b(?:poster|advertisement|advertising|flyer|banner)\b',
 'profile-avatar':r'프로필|초상|증명사진|인물|\b(?:portrait|headshot|avatar)\b',
}
RULES={k:re.compile(v,re.I) for k,v in RULES.items()}

def read(path): return json.loads(path.read_text(encoding='utf-8'))
def write(path, data):
    path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_suffix(path.suffix+'.part')
    temp.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    temp.replace(path)
def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''): h.update(block)
    return h.hexdigest()
def clean(value):
    lines=[]
    for line in str(value or '').splitlines():
        line=line.strip()
        if ('댓글' in line and re.search('프롬|프론프트|프롭프트|프름|링크|신청|요강|다운로드',line)) or re.match(r'^[\W_]*댓글',line): continue
        if re.search(r'(그\s*동안|계정의|모든).*프롬프트.*(여기에|다\s*있어)|reactorprompt\.vercel\.app|reactor-prompts-magazine\.pages\.dev',line): continue
        if re.match(r'^(배포자|게시자|작성자|출처)\s*[:：]',line): continue
        lines.append(line)
    return '\n'.join(lines).strip()
def normalized(text): return re.sub(r'\s+',' ',unicodedata.normalize('NFKC',text or '')).strip()
def extract_args(text,declared):
    defaults={str(a.get('name','')).strip():str(a.get('default') or '') for a in declared if isinstance(a,dict)}
    args={}
    for m in re.finditer(r'\{argument\s+name="([^"]+)"\s+default="([^"]*)"\}|\{([^{}\r\n]{1,200})\}',text):
        name=(m[1] or m[3]).strip()
        if len(name)>200 or not name or not (name[0].isalpha() or name[0]=='_') or re.search(r'[{}"\r\n:=]',name): continue
        args.setdefault(name,{'name':name,'default':defaults.get(name,m[2] or '')})
    return list(args.values())
def default_prompt(text,args):
    values={str(a.get('name','')):str(a.get('default','')) for a in args if isinstance(a,dict)}
    def replace(m):
        name=(m[1] or m[3]).strip(); fallback=m[2] if m[1] is not None else m[0]
        if len(name)>200 or not name or not (name[0].isalpha() or name[0]=='_') or re.search(r'[{}"\r\n:=]',name): return m[0]
        return values.get(name) or fallback
    return re.sub(r'\{argument\s+name="([^"]+)"\s+default="([^"]*)"\}|\{([^{}\r\n]{1,200})\}',replace,text)
def categorize(title,desc,tags,content,existing='others'):
    text=' '.join([title,desc,' '.join(str(t) for t in tags)])
    scores={key:len(set(m.group().lower() for m in rule.finditer(text)))*4 + min(2,len(set(m.group().lower() for m in rule.finditer(content[:2500])))) for key,rule in RULES.items()}
    if existing in scores: scores[existing]+=3
    winner=max(scores,key=scores.get)
    return winner if scores[winner]>=4 else existing if existing in {c[0] for c in CATEGORIES} else 'others'
def preview(path,digest):
    rel=f'library/previews/{digest[:24]}.webp'
    dest=ROOT/rel
    if dest.exists(): return rel,dest.stat().st_size
    with Image.open(path) as src:
        img=ImageOps.exif_transpose(src).convert('RGB')
        img.thumbnail((560,560),Image.Resampling.LANCZOS)
        for quality,edge in [(58,560),(40,480),(28,384),(22,288),(18,224)]:
            img.thumbnail((edge,edge),Image.Resampling.LANCZOS)
            buf=io.BytesIO(); img.save(buf,'WEBP',quality=quality,method=4)
            if len(buf.getvalue())<=10000: break
        temp=dest.with_suffix('.part'); temp.write_bytes(buf.getvalue()); temp.replace(dest)
    return rel,dest.stat().st_size

def prepare_media(files):
    manifest=[]
    with ThreadPoolExecutor(max_workers=8) as pool:
        jobs={pool.submit(sha,p):p for p in files}
        for index,future in enumerate(as_completed(jobs),1):
            p=jobs[future]; manifest.append({'path':p.relative_to(CACHE).as_posix(),'bytes':p.stat().st_size,'sha256':future.result()})
    manifest.sort(key=lambda x:x['path'])
    by_hash={}
    for item in manifest: by_hash.setdefault(item['sha256'],item)
    errors=[]
    with ThreadPoolExecutor(max_workers=8) as pool:
        jobs={pool.submit(preview,CACHE/item['path'],digest):digest for digest,item in by_hash.items()}
        for index,future in enumerate(as_completed(jobs),1):
            digest=jobs[future]
            try: by_hash[digest]['preview'],by_hash[digest]['previewBytes']=future.result()
            except Exception as e: errors.append({'path':by_hash[digest]['path'],'error':str(e)})
            if index%2000==0: print(f'Previews {index}/{len(jobs)}',flush=True)
    if errors: write(ROOT/'output/studio-image-errors.json',errors); raise RuntimeError(f'{len(errors)} invalid cached images; see output/studio-image-errors.json')
    archives=[]; batch=[]; size=0
    def pack(items):
        name=f'promptstudio-images-{len(archives)+1:02}.zip'; dest=ROOT/'release-assets'/name
        with zipfile.ZipFile(dest,'w',zipfile.ZIP_STORED,allowZip64=True) as z:
            for item in items:
                z.write(CACHE/item['path'],item['path']); item['archive']=name
        archives.append({'name':name,'bytes':dest.stat().st_size,'sha256':sha(dest),'files':len(items),'url':RELEASE+name})
        print('Packed',name,len(items),flush=True)
    for item in manifest:
        if batch and size+item['bytes']>850*2**20: pack(batch); batch=[]; size=0
        batch.append(item); size+=item['bytes']
    if batch: pack(batch)
    return manifest,by_hash,archives

def main():
    OUT.mkdir(exist_ok=True); (OUT/'previews').mkdir(exist_ok=True)
    original=read(ROOT/'gallery.json'); studio=read(ROOT/'output/studio-source/source.json')
    translations=read(ROOT/'source/translations.json'); empty_skipped=Counter(); recovered_prompts=0
    # Snapshot only media files, never application settings, credentials, or sessions.
    files=sorted([p for folder in ['images','my-cards-images'] for p in (CACHE/folder).iterdir() if p.is_file() and p.suffix.lower() in {'.png','.jpg','.jpeg','.webp','.gif','.bin','.svg'}])
    if '--catalog-only' in sys.argv:
        manifest=read(ROOT/'release-assets/promptstudio-image-manifest.json')
        archives=read(OUT/'import-report.json')['archives']; by_hash={}
        for item in manifest: by_hash.setdefault(item['sha256'],item)
    else: manifest,by_hash,archives=prepare_media(files)
    file_index={}
    for item in manifest:
        item['preview']=by_hash[item['sha256']]['preview']
        file_index.setdefault(Path(item['path']).stem,[]).append(item)
    def media(item,kind): return {'preview':item['preview'],'archive':RELEASE+item['archive'],'file':item['path'],'kind':kind,'sha256':item['sha256']}
    cards=[]; details={}; keys={}; duplicates=[]; missing=[]; recategorized=Counter()
    for post in original['posts']:
        prompt,from_translation=source_prompt(post,translations)
        if not prompt.strip(): empty_skipped['reactor']+=1; continue
        if from_translation: recovered_prompts+=1
        post={**post,'prompt':prompt}
        id='reactor:'+str(post['id']); caption=clean(post['caption']); title=caption.split('\n')[0][:180]
        category=categorize(title,'',post['tags'],post['prompt'])
        title=title or dict((k,v) for k,v,_ in CATEGORIES)[category]+' '+str(post['id'])
        images=[{'preview':im.get('preview','') if im['status']=='ok' else '', 'archive':'https://github.com/byeonghoyoo/reactor-prompts-magazine/releases/download/snapshot-2026-10-17/'+im['archive'] if im.get('archive') else '', 'file':im['path'],'kind':'original','missing':im['status']!='ok'} for im in post['images']]
        args=extract_args(post['prompt'],[])
        detail={'id':id,'content':post['prompt'],'args':args,'images':images,'translationId':str(post['id'])}
        if from_translation: detail['promptSource']='translations:ko'
        details[id]=detail
        cards.append({'id':id,'title':title,'description':caption[len(title):].strip()[:300],'category':category,'tags':post['tags'],'thumbnail':post.get('thumbnail') or '', 'imageCount':len(images),'hasPrompt':bool(post['prompt']),'variables':len(args),'origin':'reactor','personal':False,'date':post.get('timestamp') or ''})
        if post['prompt']: keys.setdefault(normalized(post['prompt']),id)
    for post in studio['prompts']:
        id='studio:'+post['id']; content=str(post.get('content') or '')
        if not content.strip(): empty_skipped['studio']+=1; continue
        args=extract_args(content,post.get('args',[]))
        title=clean(post.get('title')); desc=clean(post.get('description')); tags=post.get('searchTags') or []
        if re.search(r'https?://|\bvia\b.*prompt',title,re.I): title=re.sub(r'https?://\S+','',title).split('prompt:')[0].strip(' :-')
        if len(title)<4 or re.match(r'^(Nano Banana|Prompt:)',title,re.I): title=content.split('\n')[0][:100]
        title=title[:180] or '프롬프트 '+str(post['origId'])
        category=categorize(title,desc,tags,content,str(post.get('category') or 'others'))
        if category!=post.get('category'): recategorized[category]+=1
        base=re.sub(r'[^a-zA-Z0-9_-]','_',str(post['source']))+'_'+re.sub(r'[^a-zA-Z0-9_-]','_',str(post['origId']))
        imgs=[]
        if str(post.get('image','')).startswith('pscache:'):
            local=file_index.get(Path(post['image']).stem,[])
            if local: imgs=[media(local[0],'original')]
        else:
            full=file_index.get(base+'_full',[]); thumbs=file_index.get(base+'_thumb',[])
            if full: imgs.append(media(full[0],'original'))
            elif thumbs: imgs.append(media(thumbs[0],'cached-preview'))
        if not imgs: missing.append({'id':id,'reason':'Image file absent from local PromptStudio cache','path':post.get('image','')})
        key=normalized(default_prompt(content,args)) if content else ''
        if key and key in keys:
            target=keys[key]; duplicates.append({'id':id,'mergedInto':target,'reason':'same prompt with default variable values'})
            if len(args)>len(details[target]['args']):
                details[target]['content']=content; details[target]['args']=args
                duplicates[-1]['keptRicherTemplate']=id
            known={im.get('sha256') or im.get('file') for im in details[target]['images']}
            details[target]['images'].extend(im for im in imgs if im['sha256'] not in known)
            continue
        if key: keys[key]=id
        details[id]={'id':id,'content':content,'args':args,'images':imgs}
        cards.append({'id':id,'title':title,'description':desc[:300],'category':category,'tags':[str(t) for t in tags[:16]],'thumbnail':imgs[0]['preview'] if imgs else '', 'imageCount':len(imgs),'hasPrompt':bool(content),'variables':len(args),'origin':'studio','personal':post['source']=='user_extracted','date':str(post.get('meta',{}).get('publishedAt') or post.get('meta',{}).get('extractedAt') or '')})
    # A merged duplicate may supply an image for a card whose local file was absent.
    for card in cards:
        imgs=details[card['id']]['images']; card['imageCount']=len(imgs)
        card['variables']=len(details[card['id']]['args'])
        if not card['thumbnail'] and imgs: card['thumbnail']=next((im['preview'] for im in imgs if im.get('preview')),'')
        if not card['thumbnail']: card['missingImage']=True
    # Personal cards first, then the original gallery, then imported library.
    cards.sort(key=lambda c:(not bool(c['thumbnail']),not c['personal']))
    for offset in range(0,len(cards),160):
        part=cards[offset:offset+160]
        chunk={card['id']:details[card['id']] for card in part}
        encoded=json.dumps(chunk,ensure_ascii=False,separators=(',',':')).encode('utf-8')
        name=f'{offset//160:03}-{hashlib.sha256(encoded).hexdigest()[:10]}.json'
        write(OUT/'details'/name,chunk)
        for card in part: card['chunk']='library/details/'+name
    counts=Counter(card['category'] for card in cards)
    summary={'version':'2026-10-17-notebook-1','totalCards':len(cards),'promptCards':sum(c['hasPrompt'] for c in cards),'reactorCards':len(original['posts']),'studioSourceCards':len(studio['prompts']),'studioImportedCards':sum(c['origin']=='studio' for c in cards),'duplicatesMerged':len(duplicates),'cachedFiles':len(files),'uniqueCachedImages':len(by_hash),'cachedBytes':sum(i['bytes'] for i in manifest),'missingLocalImages':len(missing),'cardsWithoutImage':sum(not c['thumbnail'] for c in cards),'archives':archives,'categoryCounts':dict(counts),'recategorized':dict(recategorized)}
    summary.update(version='2026-10-17-notebook-5',reactorSourceCards=len(original['posts']),reactorCards=sum(c['origin']=='reactor' for c in cards),emptyPromptCardsRemoved=sum(empty_skipped.values()),translationPromptsRecovered=recovered_prompts)
    write(OUT/'catalog.json',{'version':summary['version'],'summary':summary,'groups':[{'id':i,'label':l} for i,l in GROUPS],'categories':[{'id':i,'label':l,'group':g,'count':counts[i]} for i,l,g in CATEGORIES],'cards':cards})
    write(OUT/'import-report.json',summary); write(OUT/'duplicates.json',duplicates); write(OUT/'missing-images.json',missing)
    if '--catalog-only' not in sys.argv:
        write(ROOT/'release-assets/promptstudio-image-manifest.json',manifest)
        write(ROOT/'release-assets/promptstudio-prompts.json',studio)
    write(ROOT/'release-assets/prompt-notebook-data.json',{'categories':[{'id':i,'label':l,'group':g} for i,l,g in CATEGORIES],'cards':[{**card,**details[card['id']]} for card in cards]})
    (ROOT/'release-assets/PROMPTSTUDIO-SHA256SUMS.txt').write_text(''.join(f'{a["sha256"]}  {a["name"]}\n' for a in archives),encoding='utf-8')
    print(json.dumps(summary,ensure_ascii=False,indent=2),flush=True)

if __name__=='__main__': main()
