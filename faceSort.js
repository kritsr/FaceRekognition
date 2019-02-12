const fs = require('fs')
const path = require('path')
const AWS = require('aws-sdk')
const Bottleneck = require('bottleneck')
const _MultiProgress = require('multi-progress');

AWS.config.loadFromPath('./aws-config.json')
const RK = new AWS.Rekognition({ apiVersion: '2016-06-27' })
const MultiProgress = new _MultiProgress()

const COLL_NAME = 'faceSort'
const IMG_DIR = './resources/images'
const REF_DIR = './resources/ref'
const DONE_DIR = './resources/done'
const NG_DIR = './output/NG'
const OUTPUT_DIR = './output'
const REF_PREFIX = 'REF_'
const IMG_PREFIX = 'IMG_'
const ITEM_PER_DELETE = 4000 // max 4096
const GC_INTERVAL = 60000 // ms for gc to run
const CONCUR_IMAGES_PROCESS = 30
const AWS_API_TPS = 30

const AwsLimiter = new Bottleneck({
    minTime: Math.floor(1000 / AWS_API_TPS)
})
const CollectionId = COLL_NAME

let GarbageFaceIds = []
let GcTimeout
let targetDirMap = new Map()

const pbars = []
function initProgressBars(fileAmt) {
    if (fileAmt <= 0) return
    pbars.push(MultiProgress.newBar('Overall [:bar] :current/:total(:percent)', { total: fileAmt, complete: '#' }));
    for (let i = 0; i < CONCUR_IMAGES_PROCESS; i++) {
        const bar = MultiProgress.newBar(':label [:bar] :current/:total(:percent)', { total: 1 })
        bar._tick = (x = 1) => { bar.tick(x, { label: bar.label }) }
        bar.curr = 1
        pbars.push(bar);
    }
    pbars.forEach(b => { b.tick(0) })
}

function isCollectionExists() {
    return RK.listCollections().promise().then(data => data.CollectionIds.includes(CollectionId))
}

function gc() {
    deleteFaces(GarbageFaceIds)
    GarbageFaceIds = []
    GcTimeout = setTimeout(gc, GC_INTERVAL)
}

// Return a-b
function subtractSet(a, b) {
    const c = new Set(a)
    b.forEach(i => c.delete(i))
    return [...c]
}

/*
Charged API
DetectFaces, IndexFaces
SearchFaceByImage, SearchFaces, and ListFaces
*/

/*
ExternalId [a-zA-Z0-9_.\-:]+
*/

function isRef(a) {
    return a.startsWith(REF_PREFIX)
}

function isImg() {
    return a.startsWith(IMG_PREFIX)
}

function removePrefix(name) {
    return name.substr(4)
}

function removeSuffix(name) {
    return name.replace(/\d+$/, '')
}

function removePrefixAndSuffix(extId) {
    return removeSuffix(removePrefix(extId))
}

function mkdir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir)
}

function copyToDir(filePath, dir) {
    const fileName = path.basename(filePath)
    const dst = path.join(dir, fileName)
    fs.copyFileSync(filePath, dst)
}

function start() {
    isCollectionExists(CollectionId)
        .then(isExists => {
            // Check if exist, return current list
            if (!isExists) return RK.createCollection({ CollectionId }).promise().then(() => [])
            console.log('Old collection detected, resuming work')
            return RK.listFaces({ CollectionId }).promise().then(data => data.Faces)
        })
        .then(data => {
            // Check REF completeness
            const currentRef = data.map(f => f.ExternalImageId).filter(isRef).map(removePrefix)
            const refIdFileMap = getJpgPathMap(REF_DIR)
            const leftOverName = subtractSet(refIdFileMap.keys(), currentRef)
            return Promise.all([
                // Add remaining REF
                ...leftOverName.map(ref => addRefFace(refIdFileMap.get(ref), ref)
                ),
                // Clean IMG, etc
                ...deleteFaces(data.filter(d => !isRef(d.ExternalImageId)).map(d => d.FaceId))
            ]).then(() => [...refIdFileMap.keys()].map(removeSuffix))
        })
        .then((nameList) => {
            // Create output directory
            mkdir(OUTPUT_DIR)
            mkdir(DONE_DIR)
            targetDirMap = new Map(nameList.map(name => {
                const dir = path.join(OUTPUT_DIR, name)
                mkdir(dir)
                return [name, dir]
            }))
        })
        .then(() => {
            const imgIdFileMap = getJpgPathMap(IMG_DIR)
            GcTimeout = setTimeout(gc, GC_INTERVAL)
            return sortImages(imgIdFileMap)
        })
        .then(() => {
            clearTimeout(GcTimeout)
            MultiProgress.terminate()
            console.log('All images processed. Clean up data')
            return RK.deleteCollection({ CollectionId }).promise()
        })
        .then(() => {
            console.log('FINISHED')
        })
}

function sortImages(imgIdFileMap) {
    // Limit concurrency
    const limiter = new Bottleneck({
        maxConcurrent: CONCUR_IMAGES_PROCESS
    })
    initProgressBars(imgIdFileMap.size)
    return Promise.all([...imgIdFileMap].map(e =>
        limiter.schedule(() => sortImage(...e)).then(() => { pbars[0].tick() })
    ))
}

function sortImage(id, imagePath) {
    let bar = pbars.slice(1).find(bar => bar.curr == bar.total)
    if (bar === undefined) bar = { _tick: () => { } }
    bar.curr = 0
    bar.total = bar.width = 1
    bar.label = id
    bar._tick(0)
    return searchPersonsInImage(imagePath, id, bar)
        .then(persons => { // Copy image to output
            persons = persons.filter(p => targetDirMap.has(p))
            persons.forEach(person => {
                copyToDir(imagePath, targetDirMap.get(person))
            })
            if (persons.length == 0) {
                mkdir(NG_DIR)
                copyToDir(imagePath, NG_DIR)
            }
        })
        .then(() => { // Move image to done (marked as done)
            const fileName = path.basename(imagePath, id)
            const dst = path.join(DONE_DIR, fileName)
            fs.renameSync(imagePath, dst)
        })
        .then(() => {
            bar.curr = bar.total
        })
}

// Return array of name
function searchPersonsInImage(imagePath, id, bar) {
    let faceIds = []
    return addImg(imagePath, id)
        .then(data => {
            faceIds = data.FaceRecords.map(fr => fr.Face.FaceId)
            bar.total = bar.width = faceIds.length
            bar._tick(0)
        })
        .then(() => Promise.all(faceIds.map(f => searchFaceName(f, bar))))
        .then(data => {
            GarbageFaceIds.push(...faceIds)
            return data
        })
}

// Return name
function searchFaceName(FaceId, bar) {
    return AwsLimiter.schedule(() => RK.searchFaces({ CollectionId, FaceId }).promise())
        .then(data => {
            const ns = data.FaceMatches
                .map(fm => fm.Face.ExternalImageId)
                .filter(isRef)
                .map(removePrefixAndSuffix)
            bar._tick()
            return ns.length > 0 ? ns[0] : null
        })
}

function deleteFaces(delFaceIds) {
    const promises = [];
    for (let i = 0; i < delFaceIds.length; i += ITEM_PER_DELETE) {
        promises.push(AwsLimiter.schedule(() => {
            const FaceIds = delFaceIds.slice(i, i + ITEM_PER_DELETE)
            return RK.deleteFaces({ CollectionId, FaceIds }).promise()
        }))
    }
    return promises
}

function getBaseName(filePath) {
    return path.basename(filePath, path.extname(filePath))
}

function getJpgPathMap(dirPath) {
    return new Map(fs.readdirSync(dirPath)
        .filter(p => path.extname(p).toLowerCase() === '.jpg')
        .map(p => path.join(dirPath, p))
        .map(f => [getBaseName(f), f])
    )
}

function addFace(ImagePath, ExternalImageId, MaxFaces) {
    const Image = getImageParam(ImagePath);
    const params = { CollectionId, Image, ExternalImageId }
    if (MaxFaces) params.MaxFaces = MaxFaces
    return AwsLimiter.schedule(() => RK.indexFaces(params).promise())
}

function addRefFace(ImagePath, ExternalImageId) {
    return addFace(ImagePath, REF_PREFIX + ExternalImageId, 1)
}
function addImg(ImagePath, ExternalImageId) {
    return addFace(ImagePath, IMG_PREFIX + ExternalImageId)
}

function getImageParam(path) {
    return { Bytes: fs.readFileSync(path) };
}

start()
// RK.listCollections().promise().then(data=>{console.log(data)})