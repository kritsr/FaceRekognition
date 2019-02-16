function submitForm() {
  console.log('SUBMITTTT')
}

window.addEventListener('load', function () {
  const forms = document.getElementsByClassName('needs-validation');
  [...forms].filter(form => {
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

  const fileInputs = document.querySelectorAll('input[type=file]');
  [...fileInputs].forEach(input => {
    const label = document.querySelector(`label.custom-file-label[for=${input.id}]`)
    const feedback = document.querySelector(`label.invalid-feedback[for=${input.id}]`)
    input.addEventListener('input', e => {
      input.setCustomValidity('')
      if (input.files.length !== 1) {
        label.innerText = 'No image chosen'
        return
      }
      const file = input.files[0]
      label.innerText = file.name
      if (file.type !== 'image/jpeg') {
        input.setCustomValidity(feedback.innerText = 'Invalid file type')
        e.stopImmediatePropagation()
      }
    })
  })

  const inputs = document.getElementsByTagName('input');
  [...inputs].forEach(input => {
    const feedback = document.querySelector(`label.invalid-feedback[for=${input.id}]`)
    if (feedback === null) return
    input.addEventListener('input', () => {
      if (input.validationMessage) feedback.innerText = input.validationMessage
    })
    input.dispatchEvent(new CustomEvent('input'))
  })

}, false)
