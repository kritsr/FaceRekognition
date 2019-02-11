const fs = require('fs')
const path = require('path')
const AWS = require('aws-sdk')
const Bottleneck = require('bottleneck')
const AwsLimiter = new Bottleneck({
    minTime: 1000 / 10
})
AWS.config.loadFromPath('./aws-config.json')
const RK = new AWS.Rekognition({ apiVersion: '2016-06-27' })

const COLL_NAME = 'faceSort'
const IMG_DIR = './resources/images'
const REF_DIR = './resources/ref'
const DONE_DIR = './resource/done'
const OUTPUT_DIR = './output'
const REF_PREFIX = 'REF_'
const IMG_PREFIX = 'IMG_'
const ITEM_PER_DELETE = 4000 // max 4096
const GC_INTERVAL = 60000 // ms for gc to run

const CollectionId = COLL_NAME
const GarbageFaceIds = []
let GcTimeout

// RK.deleteCollection({CollectionId}).promise().then(()=>console.log('FINN'))

checkOrCreateRefCollection()
// .then(() => recognizeFacesInImage(COLL_NAME, IMAGES_DIR))

function isCollectionExists() {
    return RK.listCollections().promise().then(data => data.CollectionIds.includes(CollectionId))
}

function gc() {
    deleteFaces(FaceIds)
    setTimeout(GC_INTERVAL)
    clearTimeout
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
    return name.replace(/\d+$/,'')
}

function removePrefixAndSuffix(extId) {
    return removeSuffix(removePrefix(extId))
}

function checkOrCreateRefCollection() {
    isCollectionExists(CollectionId)
        .then(isExists => {
            // Check if exist, return current list
            if (!isExists) return RK.createCollection({ CollectionId }).promise().then(() => [])
            console.log('Old collection detected, resume work')
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
            ]).then(()=>[...refIdFileMap.keys()].map(removeSuffix))
        })
        .then((nameList) => {
            // Create output directory
            if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR)
            nameList.forEach(name => {
                const dir = path.join(OUTPUT_DIR, name)
                if (!fs.existsSync(dir)) fs.mkdirSync(dir)
            })
        })
        .then(() => {
            const imgIdFileMap = getJpgPathMap(IMG_DIR)
            GcTimeout = setTimeout(gc, GC_INTERVAL)
            return sortImages(imgIdFileMap)
        })
        .then(() => {
            clearTimeout(GcTimeout)
            console.log('FINNNN')
        })
}

function sortImages(){

}

// function createRefCollection(collection, dir) {
//     return createCollection(collection)
//         // Index reference face
//         .then(() => indexRefFaceDir(collection, dir))
//         .then(data => {
//             return data.filter(d => d !== null).map(d => {
//                 let face = d.FaceRecords[0].Face
//                 return { FaceId: face.FaceId, ExternalImageId: face.ExternalImageId, Name: getNameFromRef(face.ExternalImageId) }
//             })
//         })
//         .then((faces) => {
//             // Create output directory
//             if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR)
//             const dirSet = new Set(faces.map(f => path.join(OUTPUT_DIR, f.Name)))
//             dirSet.forEach(dir => {
//                 if (!fs.existsSync(dir)) fs.mkdirSync(dir)
//             })
//             // console.log(faces)
//         })
// }

// function getNameFromRef(RefExId) {
//     return RefExId.slice(4, RefExId.length - 2)
// }

// function recognizeFacesInImage(collection, dir) {
//     const imagePaths = getJpgPaths(dir)
//     Promise.all(imagePaths.map((imagePath, i) => searchFacesInImage(collection, imagePath, i, imagePaths.length)))
//         // serializePromise(imagePaths, (a, i) => searchFacesInImage(collection, a, i, imagePaths.length))
//         // Clean up data
//         .then(data => {
//             const FaceIds = data.map(d => d.SearchResult.map(s => s.SearchedFaceId))
//                 .reduce((a, b) => a.concat(b), [])
//             const itemsPerDelete = 4000 // Max 4096 items
//             for (let i = 0; i < FaceIds.length; i += itemsPerDelete) {
//                 const params = {
//                     CollectionId: collection,
//                     FaceIds: FaceIds.slice(i, i + itemsPerDelete)
//                 }
//                 RK.deleteFaces(params)
//             }
//             return data
//         })
//         .then(data => {
//             result = data.map(d => ({
//                 ImageName: d.ImageName,
//                 Faces: d.SearchResult.map(sr => sr.BestMatch).filter(m => m !== null).map(getNameFromRef)
//             }))
//             return result
//         })
//         .then(data => {
//             // Copy to folder
//             data.forEach(d => {
//                 const src = path.join(IMAGES_DIR, d.ImageName)
//                 const dsts = d.Faces.map(f => path.join(OUTPUT_DIR, f, d.ImageName))
//                 dsts.forEach(dst => {
//                     fs.copyFileSync(src, dst)
//                 })
//             })
//             return data;
//         })
//         .then(data => { // Reverse data
//             const m = new Map()
//             data.forEach(d => {
//                 d.Faces.forEach(f => {
//                     if (!m.has(f)) m.set(f, [])
//                     m.get(f).push(d.ImageName)
//                 })
//             });
//             return m
//         })
//         .then(d => { console.log(d); return d })
// }

// function searchFacesInImage(CollectionId, imagePath, i, n) {
//     const imageName = path.basename(imagePath)
//     // console.log(`Indexing ${imageName} ${i + 1}/${n}`)
//     return addFace(CollectionId, getImageParam(imagePath), 'IMG_' + imageName)
//         .then(d => d.FaceRecords.map(fr => fr.Face.FaceId))
//         .then(FaceIds => {
//             console.log(`${FaceIds.length} faces found.`)
//             return FaceIds
//         })
//         // .then(FaceIds => serializePromise(FaceIds, (FaceId, i) => {
//         //     console.log(`Searching face ${i + 1}/${FaceIds.length}`)
//         //     return RK.searchFaces({ CollectionId, FaceId }).promise()
//         // }))
//         .then(FaceIds => Promise.all(FaceIds.map((FaceId, i) => {
//             // console.log(`Searching face ${i + 1}/${FaceIds.length}`)
//             return RK.searchFaces({ CollectionId, FaceId }).promise()
//         })))
//         .then(data => ({
//             ImageName: imageName,
//             SearchResult: data.map(d => {
//                 // d.FaceMatches = d.FaceMatches.filter(f => f.Face.ExternalImageId !== imageName)
//                 d.FaceMatches = d.FaceMatches.filter(f => !/IMG_.*/.test(f.Face.ExternalImageId))
//                 return {
//                     SearchedFaceId: d.SearchedFaceId,
//                     BestMatch: d.FaceMatches.length > 0 ? d.FaceMatches[0].Face.ExternalImageId : null,
//                     FaceMatches: d.FaceMatches.map(faceMatch => ({
//                         Similarity: faceMatch.Similarity,
//                         FaceId: faceMatch.Face.FaceId,
//                         ExternalImageId: faceMatch.Face.ExternalImageId
//                     }))
//                 }
//             })
//         }))
// }


// function createCollection(CollectionId) {
//     return RK.listCollections().promise()
//         .then(data => {
//             if (data.CollectionIds.includes(CollectionId)) {
//                 // console.log(`Collection ${CollectionId} found.`)
//                 // console.log('Deleting')
//                 return deleteCollection(CollectionId)
//             }
//         })
//         .then(() => RK.createCollection({ CollectionId }).promise())
//         .then(`Collection ${CollectionId} created`)
// }

// function deleteCollection(CollectionId) {
//     return RK.deleteCollection({ CollectionId }).promise()
// }


function deleteFaces(delFaceIds) {
    const promises = [];
    for (let i = 0; i < delFaceIds.length; i += ITEM_PER_DELETE) {
        promises.push(AwsLimiter.schedule(() => {
            const FaceIds = delFaceIds.slice(i, i + ITEM_PER_DELETE)
            console.log(`Deleting ${FaceIds.length} faces`)
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
    return AwsLimiter.schedule(() => {
        console.log(`Uploading ${ImagePath}`)
        return RK.indexFaces(params).promise()
    })
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
