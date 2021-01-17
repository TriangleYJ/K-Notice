const mongoose = require('mongoose');
const my_db = require('./notice.json')

const db = mongoose.connection;
db.on('error', console.error);
db.once('open', function(){
    console.log("Connected to mongod server");
});

mongoose.connect(`mongodb://root:pazzw0rc1@localhost/kalert?authSource=admin`, {useNewUrlParser: true})

const Schema = mongoose.Schema;

const viewSchema = new Schema({
    time: String,
    views: Number
})

const noticeSchema = new Schema({
    belong: String,
    date: String,
    href: { type: String, required: true, unique:true},
    last_updated: String,
    title: String,
    views: [viewSchema],
    writer: String,
})

const Notice = mongoose.model('Notice', noticeSchema)
const View = mongoose.model('View', viewSchema)

for(let i of Object.values(my_db.notices)){
    const notice = new Notice({
        belong: i.belong,
        date: i.date,
        href: i.href,
        last_updated: i.last_updated,
        title: i.title,
        writer: i.writer,
        views: []
    })
    for(let j in i.views){
        notice.views.push(new View({
            time: j,
            views: i.views[j]
        }))
    }
    notice.save((err) => {
        console.log(err)
    })
}

