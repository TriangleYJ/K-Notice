const express = require('express');
const puppeteer = require('puppeteer');
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const mongoose = require('mongoose');
const totp = require('totp-generator');

//in dev =? change process.env to require(./credentials) / change polling / mongodb local
const {MY_CHAT_ID, BOT_TOKEN, MY_PORTAL_ID, MY_PORTAL_PW, MY_TOTP_KEY, WEBHOOK_URL} = process.env;
const {MONGO_INITDB_ROOT_USERNAME, MONGO_INITDB_ROOT_PASSWORD, MONGO_HOST, MONGO_INITDB_DATABASE} = process.env;
const port = process.env.PORT || 3008;

const app = express();
app.use(express.json());
const bot = new TelegramBot(BOT_TOKEN);
bot.setWebHook(WEBHOOK_URL + '/webhook')

const MAX_PAGE_COUNT = 50;
const user_pref = {
    "min_view" : 500,
    "thres_popular" : 7.5E-5,
    "thres_time" : 25000000
};

const db = mongoose.connection;
db.on('error', console.error);
db.once('open', function(){
    console.log("Connected to mongod server");
});
mongoose.connect(`mongodb://${MONGO_INITDB_ROOT_USERNAME}:${MONGO_INITDB_ROOT_PASSWORD}@${MONGO_HOST}/${MONGO_INITDB_DATABASE}?authSource=admin`, {useNewUrlParser: true})
//mongoose.connect('mongodb://localhost/kalert', {useNewUrlParser: true})

const Schema = mongoose.Schema;

const noticeSchema = new Schema({
    belong: String,
    date: String,
    href: { type: String, required: true, unique:true},
    last_updated: String,
    title: String,
    views: {},
    writer: String,
    weight_view: Number,
    weight_popular: String,
    created_at: String,
},{ versionKey: false })

const Notice = mongoose.model('Notice', noticeSchema)

const JDate = date => new Date((date ? new Date(date) : new Date()).toLocaleString("en-US", {timeZone: "Asia/Seoul"}));
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

const entityMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '/': '&#x2F;', '`': '&#x60;', '=': '&#x3D;' };
function escapeHtml (string) {
    return String(string).replace(/[&<>"'`=\/]/g, function (s) {
        return entityMap[s];
    });
}
/*eslint-disable */
const parse = async date_string => {
    const browser = await puppeteer.launch({executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox', '--disable-setuid-sandbox']})
    try {
        const page = await browser.newPage()

        await page.goto('https://portal.kaist.ac.kr')
        await page.type('#IdInput', MY_PORTAL_ID);
        await page.click('body > div > div > div:nth-child(3) > div > div > fieldset > ul > li:nth-child(2) > input[type=submit]:nth-child(2)');
        await page.type('#passwordInput', MY_PORTAL_PW);
        await page.click('body > div > div > div:nth-child(3) > div > div > fieldset > ul > li:nth-child(3) > input.loginbtn');
        await page.waitForSelector('#google');
        await page.click('#google');
        await page.type('body > div > div > div:nth-child(3) > div > div > fieldset > ul > li.pass > input[type=password]', totp(MY_TOTP_KEY))
        await page.click('body > div > div > div:nth-child(3) > div > div > fieldset > ul > li.log > input[type=submit]');

        await page.waitForSelector("#ptl_headerArea")
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
                        if (col_num === "4" && date.getTime() > new Date(fds(text)).getTime()) {
                            let pages = await browser.pages();
                            await Promise.all(pages.map(page =>page.close()));
                            await browser.close();
                            return list
                        }
                    }
                    let href = await page.evaluate(element => element.getAttribute('href'), await cols[0].$("a"))
                    new_row.push(href)
                    list.push(new_row)
                }
                page_num++
            }
            let pages = await browser.pages();
            await Promise.all(pages.map(page =>page.close()));
            await browser.close()
            return list
        }


        return await parser_until_date(new Date(date_string))

    } catch (e) {
        let pages = await browser.pages();
        await Promise.all(pages.map(page =>page.close()));
        await browser.close()
        console.error("Crawling Failed! : " + e.toString(), {structuredData: true});
    }
}

const updater = async (days) => {
    const DB_1days = await parse(getDateStringBefore(days))
    for (let i of DB_1days) {
        Notice.findOne({href: i[5]}, async (err, my_prev_obj)=> {
            const cur_time = new Date().getTime()
            if (my_prev_obj) {
                //Determine trending notice

                const last_view_time = my_prev_obj.last_updated
                const last_view = my_prev_obj.views[last_view_time]
                const created_at = my_prev_obj.created_at
                const instant_popular = (i[3] - last_view)/(cur_time - last_view_time)
                const time_to_some_views = (cur_time - my_prev_obj.views[created_at])


                let weight_popular = my_prev_obj["weight_popular"] ? my_prev_obj["weight_popular"] * 1.5 : 1
                let weight_view = my_prev_obj["weight_view"] ? my_prev_obj["weight_view"] * 2 : 1

                if(instant_popular > weight_popular * user_pref["thres_popular"]){
                    await bot.sendMessage(MY_CHAT_ID, `[실시간 인기 급상승 공지 알림]\n[${i[3]}회] <a href="https://portal.kaist.ac.kr${i[5]}">${escapeHtml(i[0])}</a>\n`, {parse_mode: "HTML", reply_markup: JSON.stringify({inline_keyboard: [[{text: '바로 확인하기', callback_data: 'view'+i[5]}]]})})
                    my_prev_obj.weight_popular = weight_popular
                }
                while(time_to_some_views < user_pref["thres_time"] && i[3] > weight_view * user_pref["min_view"]){
                    await bot.sendMessage(MY_CHAT_ID, `[실시간 조회수 ${weight_view * user_pref["min_view"]} 돌파 인기 공지 알림]\n[${i[3]}회] <a href="https://portal.kaist.ac.kr${i[5]}">${escapeHtml(i[0])}</a>\n`, {parse_mode: "HTML", reply_markup: JSON.stringify({inline_keyboard: [[{text: '바로 확인하기', callback_data: 'view'+i[5]}]]})})
                    my_prev_obj.weight_view = weight_view
                    weight_view *= 2
                }

                // Update notice
                my_prev_obj.title = i[0]
                my_prev_obj.last_updated = cur_time
                my_prev_obj.set('views.' + cur_time, i[3])
                await my_prev_obj.save()

            } else {
                // New notice
                const notice = new Notice({
                    title: i[0],
                    belong: i[1],
                    writer: i[2],
                    views: {[cur_time]: i[3]},
                    date: i[4],
                    href: i[5],
                    last_updated: cur_time,
                    created_at: cur_time,
                })
                await notice.save()
            }
        })
    }
    return null;
}

/*eslint-enable */
const top_notice = async (st, ed, days) => {
    const date_string = getDateStringBefore(days)
    const glv = a => a.views[a.last_updated]

    const db = await Notice.find({date: {$gte: sdf(date_string)}})
    let stringBuilder = ""
    let my_board = [[], [], []]
    let cnt = st
    if(db) {
        for (let j of db.sort((a, b) => glv(b) - glv(a)).slice(st - 1, ed)) {
            stringBuilder += `${cnt}. [${glv(j)}회] <a href="https://portal.kaist.ac.kr${j["href"]}">${escapeHtml(j["title"])}</a>\n`
            if((cnt-1)%10 >= 5) my_board[1].push({text: cnt, callback_data: 'view' + j["href"]})
            else my_board[0].push({text: cnt, callback_data: 'view' + j["href"]})
            cnt++
        }
    }

    if (cnt === st) stringBuilder = "더이상 존재하지 않습니다!"
    //if (cnt === ed + 1) stringBuilder += `다음 페이지 : /next${days}_${cnt}_${cnt + (ed - st)}`
    if(cnt > 11) my_board[2].push({ text: '이전 페이지', callback_data: `next${days}_${st - 10}_${st - 1}`})
    if(cnt <= db.length) my_board[2].push({ text: '다음 페이지', callback_data: `next${days}_${cnt}_${cnt + (ed - st)}`})
    let option = {
        reply_markup: JSON.stringify({
            inline_keyboard: my_board
        }),
        parse_mode: "HTML"
    };
    return {
        msg: stringBuilder,
        option: option
    };
}


const main = async () => {
    await bot.sendMessage(MY_CHAT_ID, "하루 동안 가장 인기있었던 공지입니다.")
    const tn = await top_notice(1, 10, 1)
    await bot.sendMessage(MY_CHAT_ID, tn.msg, tn.option)
    return null;
}

bot.onText(/\/next(.+)_(.+)_(.+)/, async (msg, match) => {
    const tn = await top_notice(parseInt(match[2]), parseInt(match[3]),parseInt(match[1]))
    await bot.sendMessage(MY_CHAT_ID, tn.msg, tn.option);
});

bot.onText(/n (.+)/g, async (msg, match) => {
    bot.sendMessage(MY_CHAT_ID, `${match[1]}일 동안 가장 인기있었던 공지입니다.`)
    const tn = await top_notice(1, 10, parseInt(match[1]))
    bot.sendMessage(MY_CHAT_ID, tn.msg, tn.option)
})

app.post(`/webhook`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

app.listen(port, () => {
    console.log("Start to listen from " + port)
})

cron.schedule('*/10 7-23 * * *', () =>{
    updater(1)
}, { timezone : "Asia/Seoul" });

cron.schedule('0 9,18 * * *', () => {
    main()
}, { timezone : "Asia/Seoul" });

Notice.exists({}, (err, res) => {
    if(!res){
        updater(14)
    }
})

const viewer = async(href) => {
    const browser = await puppeteer.launch({executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox', '--disable-setuid-sandbox']})
    const page = await browser.newPage();
    await page.goto('https://portal.kaist.ac.kr')
    await page.type('#IdInput', MY_PORTAL_ID);
    await page.click('body > div > div > div:nth-child(3) > div > div > fieldset > ul > li:nth-child(2) > input[type=submit]:nth-child(2)');
    await page.type('#passwordInput', MY_PORTAL_PW);
    await page.click('body > div > div > div:nth-child(3) > div > div > fieldset > ul > li:nth-child(3) > input.loginbtn');
    await page.waitForSelector('#google');
    await page.click('#google');
    await page.type('body > div > div > div:nth-child(3) > div > div > fieldset > ul > li.pass > input[type=password]', totp(MY_TOTP_KEY))
    await page.click('body > div > div > div:nth-child(3) > div > div > fieldset > ul > li.log > input[type=submit]');

    await page.waitForSelector("#ptl_headerArea")
    await page.click('#ptl_hearderWrap > div.ptl_homeNav > ul > li:nth-child(5) > a')
    await page.waitForSelector('#wrap')
    //await page.emulate(iPhone)
    await page.goto('https://portal.kaist.ac.kr' + href)
    await page.screenshot({
        fullPage: true,
        path: './viewer.jpeg'
    })
    let pages = await browser.pages();
    await Promise.all(pages.map(page =>page.close()));
    await browser.close()
    bot.sendPhoto(MY_CHAT_ID, 'viewer.jpeg')
}

bot.on('callback_query', async function onCallbackQuery(callbackQuery) {
    const action = callbackQuery.data;
    const msg = callbackQuery.message;
    const opts = {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
    };

    if(action.substr(0, 4) === "next"){
        const match = /next(.+)_(.+)_(.+)/.exec(action)
        const tn = await top_notice(parseInt(match[2]), parseInt(match[3]),parseInt(match[1]))
        await bot.editMessageText(tn.msg, {...tn.option, ...opts});
    }
    if(action.substr(0, 4) === "view"){
        const match = /view(.+)/.exec(action)
        await viewer(match[1])
    }
});
