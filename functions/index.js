const functions = require('firebase-functions');
const express = require('express');
const puppeteer = require('puppeteer')
const TelegramBot = require('node-telegram-bot-api')
const admin = require('firebase-admin')
const {MY_CHAT_ID, BOT_TOKEN, my_id, my_pw} = require('./credentials.js')
const app = express();
const MAX_PAGE_COUNT = 50

const serviceAccount = require("./kaist-notice-firebase-adminsdk-1mjhs-7f00632e1e.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://kaist-notice-default-rtdb.firebaseio.com"
});
const JDate = date => new Date((date ? new Date(date) : new Date()).toLocaleString("en-US", {timeZone: "Asia/Tokyo"}));
const defaultAuth = admin.auth();
const defaultDatabase = admin.database();
const formatDate = (d) => {
    let month = '' + (d.getMonth() + 1),
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


/*eslint-disable */
const parse = async date_string => {
    try {
        const browser = await puppeteer.launch({args: [ '--no-sandbox', '--disable-setuid-sandbox']})
        const page = await browser.newPage()

        await page.goto('https://portal.kaist.ac.kr')
        await page.evaluate((id, pw) => {
            document.querySelector('input[name="userId"]').value = id;
            document.querySelector('input[name="password"]').value = pw;
        }, my_id, my_pw);
        await page.click('a[name="btn_login"]');

        await page.waitForNavigation()

        const parser_until_date = async date => {
            let page_num = 1;
            let list = [];
            while (page_num <= MAX_PAGE_COUNT) {
                await page.goto(`https://portal.kaist.ac.kr/board/list.brd?boardId=today_notice&lang_knd=ko&userAgent=Chrome&isMobile=false&page=${page_num.toString()}&userAgent=Chrome&isMobile=False&sortColumn=REG_DATIM&sortMethod=DESC`)
                let rows = await page.$$("table > tbody > tr");
                rows.shift();
                for (let row of rows) {
                    let new_row = []
                    const cols = await row.$$("td")
                    for (let col_num in cols) {
                        let text = await page.evaluate(element => element.textContent, cols[col_num]);
                        text = text.replace(/\t/g, '').replace(/\n/g, '')
                        if (col_num === "3") text = parseInt(text)
                        new_row.push(text)
                        if (col_num === "4" && date.getTime() > new Date(fds(text)).getTime()){
                            await browser.close()
                            return list
                        }
                    }
                    let href = await page.evaluate(element => element.getAttribute('href'), await cols[0].$("a"))
                    new_row.push(href)
                    list.push(new_row)
                }
                page_num++
            }
            await browser.close()
            return list
        }


        return await parser_until_date(new Date(date_string))

    } catch (e) {
        functions.logger.error("Crawling Failed! : " + e.toString(), {structuredData: true});
        console.error("Crawling Failed! : " + e.toString(), {structuredData: true});
    }
}

const daily_updater = async () => {
    const DB_1days = await parse(getDateStringBefore(1))
    const ref = await defaultDatabase.ref('notices')
    for(let i of DB_1days) {
        await ref.orderByChild("href").equalTo(i[5]).once("value", snapshot => {
            if (snapshot.exists()) {
                const my_key = Object.keys(snapshot.val())[0];
                ref.child(`${my_key}/title`).set(i[0])
                ref.child(`${my_key}/views/${new Date().getTime()}`).set(i[3])
            } else {
                ref.push({
                    title: i[0],
                    belong: i[1],
                    writer: i[2],
                    views: {
                        [new Date().getTime()]: i[3]
                    },
                    date: i[4],
                    href: i[5]
                })
            }
        });
    }


    return null;
}
/*eslint-enable */

const runtimeOpts = {
    timeoutSeconds: 90,
    memory: '1GB'
}

exports.notice_updater = functions.region('asia-northeast1').runWith(runtimeOpts).pubsub.schedule('*/10 9-21 * * *').timeZone('Asia/Tokyo').onRun(async (context) => {
    return daily_updater()
});

