/* Server-verified readers. Filing information is intentionally not consulted. */
(function(global){
  'use strict';
  async function requireReady(client){
    var result = await client.rpc('document_privacy_ready');
    if(result.error || result.data !== true) throw new Error('Neue Dokumente und Freigaben sind gesperrt, bis die Zugriffsregeln in der Datenbank aktiviert und geprüft sind.');
  }
  async function mount(holder, client, fileId){
    if(!holder) return;
    var generation = (holder.accessGeneration || 0) + 1;
    holder.accessGeneration = generation;
    holder.textContent = 'Zugriff wird auf dem Server geprüft …';
    function current(){ return holder.isConnected && holder.accessGeneration === generation; }
    try {
      await requireReady(client);
      var readers = [];
      for(var offset = 0; ; offset += 500){
        var result = await client.rpc('get_document_readers', { p_file_id:fileId }).range(offset, offset + 499);
        if(!current()) return;
        if(result.error || !Array.isArray(result.data)) throw new Error('Zugriffsprüfung nicht verfügbar.');
        readers = readers.concat(result.data);
        if(result.data.length < 500) break;
      }
      holder.replaceChildren();
      var heading = document.createElement('strong');
      heading.textContent = 'Wer kann dieses Dokument öffnen?';
      holder.appendChild(heading);
      var hint = document.createElement('p');
      hint.className = 'doc-meta';
      hint.textContent = 'Ablage, Wohnung und Kontaktzuordnung geben keine Leserechte. Die Verwaltung und die unten freigegebenen Personen haben Zugriff.';
      holder.appendChild(hint);
      readers.forEach(function(reader){
        var row = document.createElement('div');
        row.className = 'document-reader-row';
        var label = document.createElement('span');
        label.textContent = (reader.display_name || 'Kontakt') + ' · ' + reader.reason + (reader.can_read ? '' : ' · derzeit gesperrt');
        row.appendChild(label);
        if(reader.has_share && reader.reason !== 'Verwaltung'){
          var button = document.createElement('button');
          button.type = 'button'; button.className = 'dash-btn-sm';
          button.textContent = 'Freigabe entziehen';
          button.onclick = async function(){
            button.disabled = true;
            var result;
            try { result = await client.rpc('revoke_document_reader', { p_file_id:fileId, p_profile_id:reader.profile_id }); }
            catch(err){ result = { error:err }; }
            if(!current()) return;
            if(result.error){
              status.textContent = 'Freigabe konnte nicht entzogen werden. Bitte erneut versuchen.';
              button.disabled = false; return;
            }
            await mount(holder, client, fileId);
          };
          row.appendChild(button);
        }
        holder.appendChild(row);
      });
      var status = document.createElement('p');
      status.className = 'doc-meta'; status.setAttribute('role', 'status');
      status.textContent = 'Entziehen verhindert neue Zugriffe. Bereits heruntergeladene Kopien bleiben beim Empfänger; zuvor erstellte Links gelten bis zu ihrem Ablauf.';
      holder.appendChild(status);
    } catch(err){
      if(!current()) return;
      holder.textContent = 'Zugriffsregeln konnten nicht bestätigt werden. Die Berechtigungsprüfung muss in der Datenbank aktiviert bzw. wieder erreichbar sein. Bitte vorerst keine vertraulichen Akten neu freigeben.';
    }
  }
  global.VeraDocumentAccess = { mount:mount, requireReady:requireReady };
})(window);
