import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
const files=(await readdir('docs/diagramas')).filter(f=>f.endsWith('.puml')).map(f=>'docs/diagramas/'+f);
const jar=process.env.PLANTUML_JAR;
for(const type of ['svg','png']){
  const executable=jar?'java':'plantuml';
  const args=jar?['-Djava.awt.headless=true','-jar',jar,'-charset','UTF-8','-t'+type,...files]:['-charset','UTF-8','-t'+type,...files];
  const r=spawnSync(executable,args,{stdio:'inherit'});
  if(r.error||r.status!==0){console.error('Instale Java/PlantUML ou configure PLANTUML_JAR apontando para o JAR oficial. As imagens prontas estão em docs/diagramas.');process.exit(1);}
}
