// draft page inline script (extracted)
    window.switchMatrixView = function(view) {
      const btnAll = document.getElementById('btn-matrix-all');
      const btnSquad = document.getElementById('btn-matrix-squad');
      const conAll = document.getElementById('matrix-all-teams-container');
      const conSquad = document.getElementById('matrix-my-squad-container');

      if (view === 'squad') {
        btnSquad.style.background = '#8c6dff';
        btnSquad.style.color = '#0b0d1a';
        btnAll.style.background = 'transparent';
        btnAll.style.color = '#4ADE80';

        conAll.classList.add('hidden');
        conSquad.classList.remove('hidden');

        if (typeof window.renderMySquadMatrix === 'function') {
          window.renderMySquadMatrix();
        }
      } else {
        btnAll.style.background = '#8c6dff';
        btnAll.style.color = '#0b0d1a';
        btnSquad.style.background = 'transparent';
        btnSquad.style.color = '#4ADE80';

        conSquad.classList.add('hidden');
        conAll.classList.remove('hidden');
      }
    };
  
