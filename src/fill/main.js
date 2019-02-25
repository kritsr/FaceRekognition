// Initialize Firebase
firebase.initializeApp({
  apiKey: "AIzaSyDHtX9Ktpr4WYcoH78UGA8Rn0bFJEjIggQ",
  authDomain: "f-web-42f24.firebaseapp.com",
  databaseURL: "https://f-web-42f24.firebaseio.com",
  projectId: "f-web-42f24",
  storageBucket: "f-web-42f24.appspot.com",
  messagingSenderId: "721726333104"
})

const db = firebase.firestore()
const storage = firebase.storage()

function disableInput() {
  const btn = document.getElementById('submitBtn')
  if (btn.disabled) return true
  btn.disabled = true
  document.getElementById('submitBtnText').innerText = 'Saving...'
  document.getElementById('submitSpinner').hidden = false
  const inputs = [...document.getElementsByTagName('input')]
  inputs.forEach(elem => {
    elem.disabled = true
  })
  return false
}

let isSubmit = false
function submitForm() {
  if (isSubmit) return
  isSubmit = true
  if (disableInput()) return
  const name = document.getElementById('inputName').value
  const mobile = document.getElementById('inputMobile').value
  const email = document.getElementById('inputEmail').value
  const photo = [
    document.getElementById('inputImage1').files[0],
    document.getElementById('inputImage2').files[0],
    document.getElementById('inputImage3').files[0]
  ].filter(x => x)
  db.collection('guests').add({
    name, mobile, email
  }).then(docRef =>
    Promise.all(photo.map((f, i) =>
      storage.ref(`${docRef.id}/${i}`).put(f)
    ))
  ).then(x => {
    location.href = 'success.html'
  }).catch(err => {
    console.error("Error adding document: ", err)
  })
}

window.addEventListener('load', function () {
  const forms = [...document.getElementsByClassName('needs-validation')]
  forms.filter(form => {
    form.addEventListener('submit', event => {
      event.preventDefault()
      if (!form.checkValidity()) {
        event.stopPropagation()
        form.classList.add('was-validated')
        form.reportValidity()
        return
      }
      submitForm()
    }, false)
  })

  const fileInputs = [...document.querySelectorAll('input[type=file]')]
  fileInputs.forEach(input => {
    const label = document.querySelector(`label.custom-file-label[for=${input.id}]`)
    const feedback = document.querySelector(`label.invalid-feedback[for=${input.id}]`)
    input.addEventListener('input', e => {
      input.setCustomValidity('')
      if (input.files.length !== 1) {
        label.innerText = 'No image chosen'
        return
      }
      const file = input.files[0]
      if (file) label.innerText = file.name
      if (file.type !== 'image/jpeg') {
        input.setCustomValidity(feedback.innerText = 'Invalid file type')
        e.stopImmediatePropagation()
      }
    })
  })

  const inputs = [...document.getElementsByTagName('input')]
  inputs.forEach(input => {
    const feedback = document.querySelector(`label.invalid-feedback[for=${input.id}]`)
    if (feedback === null) return
    input.addEventListener('input', () => {
      if (input.validationMessage) feedback.innerText = input.validationMessage
    })
    input.dispatchEvent(new CustomEvent('input'))
  })

}, false)
