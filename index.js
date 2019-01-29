const fs = require('fs')
const path = require('path')
const AWS = require('aws-sdk')
AWS.config.update({
    region: 'us-west-2'
})
const RK = new AWS.Rekognition({ apiVersion: '2016-06-27' })

const COLL_NAME = 'test'
const IMAGES_DIR = './resources/images'
const REF_DIR = './resources/ref'

const TPS_LIMIT = 40;
let tps_cnt = 0;

// const refmap = new Map()
// refmap.unset('1')
// console.log(refmap)

createRefCollection(COLL_NAME, REF_DIR)
.then(()=>recognizeFacesInImage(COLL_NAME, IMAGES_DIR))

// recognizeFacesInImage(COLL_NAME, IMAGES_DIR)

function createRefCollection(collection, dir) {
    return createCollection(collection)
        // Index reference face
        .then(() => indexRefFaceDir(collection, dir))
        .then(data => {
            indexedFaces = data.filter(d => d !== null).map(d => {
                let face = d.FaceRecords[0].Face
                return { FaceId: face.FaceId, ExternalImageId: face.ExternalImageId }
            })
        })
    // .then(() => {
    //     console.log(indexedFaces)
    // })
}

function getNameFromRef(RefExId) {
    return RefExId.slice(4, RefExId.length - 2)
}

function recognizeFacesInImage(collection, dir) {
    const imagePaths = getJpgPaths(dir)
    Promise.all(imagePaths.map(imagePath => searchFacesInImage(collection, imagePath)))
        // Clean up data
        .then(data => {
            const FaceIds = data.map(d => d.SearchResult.map(s => s.SearchedFaceId))
                .reduce((a, b) => a.concat(b), [])
            const params = {
                CollectionId: collection,
                FaceIds
            }
            RK.deleteFaces(params)
            return data
        })
        .then(data => {
            result = data.map(d => ({
                ImageName: d.ImageName,
                Faces: d.SearchResult.map(sr => sr.BestMatch).filter(m => m !== null).map(getNameFromRef)
            }))
            return result
        })
        .then(data => { // Reverse data
            const m = new Map()
            data.forEach(d => {
                d.Faces.forEach(f => {
                    if (!m.has(f)) m.set(f, [])
                    m.get(f).push(d.ImageName)
                })
            });
            return m
        })
        .then(d => { console.log(d) })
}

function searchFacesInImage(CollectionId, imagePath) {
    const imageName = getFileName(imagePath)
    return addFace(CollectionId, getImageParam(imagePath), 'IMG_' + imageName)
        .then(d => d.FaceRecords.map(fr => fr.Face.FaceId))
        .then(FaceIds => Promise.all(FaceIds.map(FaceId => RK.searchFaces({ CollectionId, FaceId }).promise())))
        .then(data => ({
            ImageName: imageName,
            SearchResult: data.map(d => {
                // d.FaceMatches = d.FaceMatches.filter(f => f.Face.ExternalImageId !== imageName)
                d.FaceMatches = d.FaceMatches.filter(f => !/IMG_.*/.test(f.Face.ExternalImageId))
                return {
                    SearchedFaceId: d.SearchedFaceId,
                    BestMatch: d.FaceMatches.length > 0 ? d.FaceMatches[0].Face.ExternalImageId : null,
                    FaceMatches: d.FaceMatches.map(faceMatch => ({
                        Similarity: faceMatch.Similarity,
                        FaceId: faceMatch.Face.FaceId,
                        ExternalImageId: faceMatch.Face.ExternalImageId
                    }))
                }
            })
        }))
}


function createCollection(CollectionId) {
    return RK.listCollections().promise()
        .then(data => {
            if (data.CollectionIds.includes(CollectionId)) {
                // console.log(`Collection ${CollectionId} found.`)
                // console.log('Deleting')
                return deleteCollection(CollectionId)
            }
        })
        .then(() => RK.createCollection({ CollectionId }).promise())
        .then(`Collection ${CollectionId} created`)
}

function deleteCollection(CollectionId) {
    return RK.deleteCollection({ CollectionId }).promise()
}

function getFileName(filePath) {
    return path.basename(filePath, path.extname(filePath))
}

function getJpgPaths(dirPath) {
    return fs.readdirSync(dirPath)
        .filter(p => path.extname(p).toLowerCase() === '.jpg')
        .map(p => path.join(dirPath, p))
}

function indexRefFaceDir(CollectionId, dirPath) {
    return Promise.all(getJpgPaths(dirPath).map(p => addRefFace(CollectionId, getImageParam(p), getFileName(p))))
}

function addFace(CollectionId, Image, ExternalImageId) {
    let params = { CollectionId, Image }
    if (ExternalImageId) params.ExternalImageId = ExternalImageId
    return RK.indexFaces(params).promise()
}

async function addRefFace(collectionId, Image, ExternalImageId) {
    if (await isSingleFaceImage(Image)) {
        return addFace(collectionId, Image, 'REF_' + ExternalImageId)
    } else {
        return null
    }
}

function getImageParam(path) {
    return { Bytes: fs.readFileSync(path) };
}

async function isSingleFaceImage(Image) {
    return RK.detectFaces({ Image }).promise().then(data => data.FaceDetails.length === 1)
}
