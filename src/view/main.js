// Initialize Firebase
firebase.initializeApp({
  apiKey: "AIzaSyDHtX9Ktpr4WYcoH78UGA8Rn0bFJEjIggQ",
  authDomain: "f-web-42f24.firebaseapp.com",
  databaseURL: "https://f-web-42f24.firebaseio.com",
  projectId: "f-web-42f24",
  storageBucket: "f-web-42f24.appspot.com",
  messagingSenderId: "721726333104"
});

const db = firebase.firestore()
const storage = firebase.storage()

db.collection("guests").get().then((querySnapshot) => {
  const content = document.getElementById('content')
  let i = 0
  const htmls = Array(querySnapshot.size)
  querySnapshot.forEach(doc => {
    const d = doc.data()
    htmls[i] = '<tr>'+
      `<th>${i+1}</th>` +
      `<td>${d.name}</td>` +
      `<td>${d.mobile}</td>` +
      `<td>${d.email}</td>` +
      '<td>'+
      `<a id="${doc.id}-1" role="button" class="btn btn-info" href="">Image#1</a>&nbsp;`+
      `<a id="${doc.id}-2" role="button" class="btn btn-info" href="">Image#2</a>&nbsp;`+
      `<a id="${doc.id}-3" role="button" class="btn btn-info" href="">Image#3</a>`+
      '</td></tr>'
    i += 1
    storage.ref(`${doc.id}/0`).getDownloadURL().then(url=>{
      document.getElementById(`${doc.id}-1`).href = url
    })
    storage.ref(`${doc.id}/1`).getDownloadURL().then(url=>{
      document.getElementById(`${doc.id}-2`).href = url
    })
    storage.ref(`${doc.id}/2`).getDownloadURL().then(url=>{
      document.getElementById(`${doc.id}-3`).href = url
    })
  });
  content.innerHTML = htmls.join('')
});
