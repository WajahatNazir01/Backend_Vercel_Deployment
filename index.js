const express = require('express')
const app = express()
const port = 3000
app.use(express.json());

app.listen(port,
    ()=>{console.log(`it is alive on http://localhost:${port}`)}
)
app.get('/shirt',(req,res)=>{
    //this is called callback function
    res.status(200).send({
        tshirt:'😒',
        size:'large'
    })
})

app.post('/shirt/:id',(req,res)=>{
    const {id} = req.params;
    const {logo} = req.body;
    if(!logo){
       return res.status(418).send({message:'we need a logo'})
    }

    res.send({
        shirt : `shirt with logggggggggggggggggggggggggggggggggggggggggggggggggggggo ${logo} and id as ${id}`
    })


})