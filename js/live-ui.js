window.toggleFormation = () => {
      const pitchWrap = document.getElementById('pitch-wrap');
      const toggleIcon = document.getElementById('toggle-icon');
      
      if (pitchWrap.style.display === 'none') {
        pitchWrap.style.setProperty('display', 'flex', 'important');
        toggleIcon.textContent = '🔼';
      } else {
        pitchWrap.style.setProperty('display', 'none', 'important');
        toggleIcon.textContent = '🔽';
      }
    }
