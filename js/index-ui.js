function togglePassword() {
      const pwd = document.getElementById("password");
      const eyeOpen = document.getElementById("eye-open");
      const eyeClosed = document.getElementById("eye-closed");
      
      if (pwd.type === "password") {
        pwd.type = "text";
        eyeOpen.classList.add("hidden");
        eyeClosed.classList.remove("hidden");
      } else {
        pwd.type = "password";
        eyeOpen.classList.remove("hidden");
        eyeClosed.classList.add("hidden");
      }
    }

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => console.log(err));
      });
    }
