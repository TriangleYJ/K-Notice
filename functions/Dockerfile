FROM node:15-alpine as build

USER root

# 앱 디렉터리 생성
WORKDIR /usr/src/app

COPY . .
# chromium 설치
RUN apk add --no-cache udev ttf-freefont chromium

# 한글 폰트 처리
RUN mkdir /usr/share/fonts/nanumfont
RUN wget http://cdn.naver.com/naver/NanumFont/fontfiles/NanumFont_TTF_ALL.zip
RUN unzip NanumFont_TTF_ALL.zip -d /usr/share/fonts/nanumfont
RUN fc-cache -f -v

# 앱 디렉토리로 다시 이동
RUN cd /usr/src/app
# npm install 시 Chromium 다운로드 제외 처리
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD true
# chromium-browser 설치 위치를 환경 변수에 저장
ENV CHROMIUM_PATH /usr/bin/chromium-browser

# 시간을 서울로 변경 처리
RUN apk --no-cache add tzdata && \
        cp /usr/share/zoneinfo/Asia/Seoul /etc/localtime && \
        echo "Asia/Seoul" > /etc/timezone

# Set the lang
ENV LANG=ko_KR.UTF-8 \
    LANGUAGE=ko_KR.UTF-8

# node module 설치
RUN npm install

# docker 외부 OPEN 포트
EXPOSE 3000
ENTRYPOINT ["npm", "start"]
