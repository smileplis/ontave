import { createOntave } from "../../dist/index.js";
import { postgres } from "../../dist/postgres.js";
const app=createOntave({storage:postgres({connectionString:process.env.ONTAVE_TEST_DATABASE}),authorize:()=>({actorId:"owner",workspaceId:process.env.ONTAVE_TEST_WORKSPACE,capabilities:["ingest","review"]}),model:{async extract(){throw Error("No inference in effect test");}}});
const request=JSON.parse(process.env.ONTAVE_TEST_REQUEST);
if(process.env.ONTAVE_TEST_OPERATION==="ingest")await app.ingest(null,request);
else await app.reviews.accept(null,request);
// The caller receives no receipt/acknowledgement after the committed transaction.
process.kill(process.pid,"SIGKILL");
