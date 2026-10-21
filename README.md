# 다음 주
AI 길잡이와 함께 짜는 한 주 시간표 앱. 휴대폰 브라우저에서 열고 "홈 화면에 추가"로 설치합니다.
- 앱: `index.html` (단일 파일) / 설치 설정: `manifest.webmanifest`, `sw.js`
- AI 서버(Cloudflare Worker) 코드는 `worker/worker.js`에 있고, Cloudflare에 따로 배포합니다. Groq API 키는 Worker의 Secret(GROQ_API_KEY)에만 있고 이 저장소에는 없습니다.
