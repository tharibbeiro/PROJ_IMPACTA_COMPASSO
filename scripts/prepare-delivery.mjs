import { cp, mkdir, readdir, rm } from 'node:fs/promises';
const directory='frontend/public/entrega';
await mkdir(directory,{recursive:true});
// Publica somente a página do projeto, o pacote do código e os diagramas atuais.
for(const entry of await readdir(directory)){
  if(!['index.html','fonte.zip'].includes(entry)) await rm(`${directory}/${entry}`,{recursive:true,force:true});
}
await cp('docs/diagramas',`${directory}/diagramas`,{recursive:true});
