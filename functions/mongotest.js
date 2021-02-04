const mongoose = require('mongoose');
const db = mongoose.connection;
const my_db = require("./kaist-notice-default-rtdb-export.json");
const {DB_USER, DB_PW} = process.env;

db.on('error', console.error);
db.once('open', function(){
    console.log("Connected to mongod server");
});
mongoose.connect(`mongodb://${DB_USER}:${DB_PW}@localhost/kalert?authSource=admin`, {useNewUrlParser: true})
//mongoose.connect('mongodb://localhost/kalert', {useNewUrlParser: true})
mongoose.set('useFindAndModify', false);

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

//save example
/*
Notice.findOne({href:'/ennotice/International/11604116217699'}, async (err, doc) => {
    const cur_time = new Date().getTime()
    doc.title = '[KI House] 2020 Korean Speech Contest'
    doc.last_updated = cur_time
    doc.views = []
    doc.views.splice(doc.views.length, 0, {time : cur_time, views :523})
    doc.save()
    console.log(doc)
})
*/

//view example
/*Notice.find({date: "2021.01.22"}, (err ,doc) => {
    for(let i in doc){
        console.log(doc[i].views, doc[i].last_updated)
    }
})*/

//DB download from firebase json file
function loadFromJson(){
    for(let i of Object.values(my_db.notices)){
        const notice_bases = {
            belong: i.belong,
            date: i.date,
            href: i.href,
            last_updated: i.last_updated,
            created_at: Object.keys(i.views)[0],
            title: i.title,
            writer: i.writer,
            views: i.views,
        }
        if(i["specials"]){
            if(i["specials"]["weight_popular"]) notice_bases["weight_popular"] = i["specials"]["weight_popular"]
            if(i["specials"]["weight_view"]) notice_bases["weight_view"] = i["specials"]["weight_view"] + ""
        }
        const notice = new Notice(notice_bases)
        notice.save((err) => {
            console.log(err)
        })
    }

}

loadFromJson()

