"""Read actual prompt text, including the source site's separate language data."""

def source_prompt(post, translations):
    original = post.get('prompt')
    if isinstance(original, str) and original.strip():
        return original, False
    key = 'prompt_' + str(post['id'])
    value = translations.get('ko', {}).get(key, '')
    if not isinstance(value, str) or not value.strip() or value.strip() == '카메라 메타데이터 있음':
        return '', False
    # Some source entries wrap the original in a classification label.
    marker = '[원문 프롬프트]'
    if marker in value:
        value = value.split(marker, 1)[1]
    return value.strip(), True
