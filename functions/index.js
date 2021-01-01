const functions = require('firebase-functions');
const express = require('express');
const puppeteer = require('puppeteer')
const TelegramBot = require('node-telegram-bot-api')
const admin = require('firebase-admin')
const {MY_CHAT_ID, BOT_TOKEN, my_id, my_pw} = require('./credentials.js')
const app = express();
const MAX_PAGE_COUNT = 50
const bot = new TelegramBot(BOT_TOKEN)

const serviceAccount = require("./kaist-notice-firebase-adminsdk-1mjhs-7f00632e1e.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://kaist-notice-default-rtdb.firebaseio.com"
});

const defaultAuth = admin.auth();
const defaultDatabase = admin.database();
const JDate = date => new Date((date ? new Date(date) : new Date()).toLocaleString("en-US", {timeZone: "Asia/Tokyo"}));
const formatDate = (date) => {
    let d = new Date(date),
        month = '' + (d.getMonth() + 1),
        day = '' + d.getDate(),
        year = d.getFullYear();

    if (month.length < 2)
        month = '0' + month;
    if (day.length < 2)
        day = '0' + day;

    return [year, month, day].join('-');
}
const getDateStringBefore = days => {
    const a = JDate()
    a.setDate(a.getDate() - days)
    return formatDate(a)
}
const fds = str => str.replace(/\./g, "-")
const sdf = str => str.replace(/-/g, ".")

const top_notice = async (st, ed, days) => {
    let db = {}

    const date_string = getDateStringBefore(days)
    const glv = a => {
        const v = a["views"]
        const max_key = Object.keys(v).sort((a,b)=>b-a)[0]
        return v[max_key]
    }

    const ref = await defaultDatabase.ref('notices')
    await ref.orderByChild('date').startAt(sdf(date_string)).once("value", snapshot => {
        db = snapshot.val()
    })


    let stringBuilder = ""
    let cnt = st
    for(let j of Object.values(db).sort((a, b) => glv(b) - glv(a)).slice(st, ed+1)){
        stringBuilder += `${cnt}. [${glv(j)}회] <a href="https://portal.kaist.ac.kr${j["href"]}">${j["title"]}</a>\n`
        cnt++
    }

    if(cnt === st) return "더이상 존재하지 않습니다!"
    if(cnt === ed + 1) stringBuilder += `다음 페이지 : /next${days}_${cnt}_${cnt+(ed-st)}`
    return stringBuilder
}


const main = async () => {
    await bot.sendMessage(MY_CHAT_ID, "하루 동안 가장 인기있었던 공지입니다.")
    await bot.sendMessage(MY_CHAT_ID, await top_notice(1, 10, 1), {parse_mode: "HTML"})
    return null;
}

/*app.get('/hello', async (req, res) => {
    await main()
    await res.send()
})

app.listen(3000, () => {
    console.log("Start to listen at 3000!")
});

exports.api = functions.https.onRequest(app)*/

exports.notice_alert = functions.region('asia-northeast1').pubsub.schedule('0 9,18 * * *').timeZone('Asia/Tokyo').onRun(async (context) => {
    return main()
});
