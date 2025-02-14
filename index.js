import express, { json, response } from 'express'
import http from 'http'
import pg from 'pg'
const { Pool, Client } = pg 
import cron from 'node-cron'
import 'dotenv/config'
import axios from 'axios';
import fs from "fs-extra";
import path from 'path';
import { Downloader } from "nodejs-file-downloader"
import {encode, decode} from 'node-base64-image';

// Iniciar instancias---------------------------
const app = express();
const server = http.createServer(app);
app.use(express.static('public'))
app.use(express.json({limit: '100mb'}))

const client = new Client({ 
  user: process.env.POSTGRES_USERNAME,
  password: process.env.POSTGRES_PASSWORD,
  host: process.env.POSTGRES_HOST,
  port: process.env.POSTGRES_PORT,
  database: process.env.POSTGRES_DATABASE
})

async function init() {
	await client.connect()
	const res = await client.query(process.env.DB_QUERY)
	console.log(res.rows)
	if (res.rowCount === 0) {
		await client.query(process.env.DB_CREATE)
		await client.query(process.env.DB_SETTING)
		await client.query(process.env.DB_PROMPT)
	} else {
		console.log('crm_posts database exists.')
	}
}
init()

app.post('/api/get', async (req, res) => {
  console.log(req.body)
  try {
	let get_setting=await client.query({
		text: "SELECT * FROM crm_posts WHERE type=$1 LIMIT 1",
		values: ["setting"]
	})
	let data = null 
	// console.log(get_setting.rows)
	switch (req.body.option) {
		case "list":
			data = await client.query({
				text: 'SELECT * FROM crm_posts WHERE type=$1 ORDER BY created_at DESC LIMIT $2',
				values: [req.body.type, get_setting.rows[0].data.chatwoot_rows],
			})
			res.json(data.rows)
			break;
		case "view":
			data = await client.query({
				text: 'SELECT * FROM crm_posts WHERE type=$1 AND id_external=$2 LIMIT 1',
				values: [req.body.type, req.body.id_external],
			})
			res.json(data.rows[0])
			break;
		default:
			break;
	}

  } catch (error) {
	console.log(error)
	res.json(error)
  }
})
app.post('/api/post', async (req, res) => {
	console.log(req.body)
	try {
		let result = null
		switch (req.body.option) {
			case "update":
				result = await client.query({
					text: 'UPDATE crm_posts SET data = $1 WHERE id=$2',
					values: [req.body.data, req.body.id]
				})
				break;
			case "create":
				result = await client.query({
					text: 'INSERT INTO crm_posts(type, data) VALUES($1, $2)',
					values: [req.body.type, req.body.data]
				})
				break;
			case "delete":
				result = await client.query({
					text: 'DELETE FROM crm_posts WHERE id=$1 RETURNING id',
					values: [req.body.id],
				})
				break;
			case "shortcode":
				if (req.body.data == 0) {
					res.json([])
					return false
				}
				let setting = await client.query("SELECT * FROM crm_posts WHERE type='setting' limit 1")
				let contact = await client.query('SELECT * FROM contacts ORDER BY updated_at DESC limit 1')
				switch (JSON.parse(req.body.data).type) {
					case "chatwoot":
						let mikeys = {
							contact_id: contact.rows[0].id,
							chatwoot_id: setting.rows[0].data.chatwoot_id,
							fecha_hora: new Date(new Date().toLocaleString('en', {timeZone: 'America/La_Paz'}))
						}
						let mival = JSON.parse(req.body.data).values
						let mivalues = []
						for (let index = 0; index < mival.length; index++) {
							for(var item in mikeys ){
								if (item === mival[index]) {
									mivalues.push(mikeys[item])
								}
							}
						}
						result = await client.query({
							text: JSON.parse(req.body.data).text,
							values: mivalues
						})
						break;
					case "wordpress":
						result = await axios.post(setting.rows[0].data.wordpress_url+(JSON.parse(req.body.data).text), {
							limit: 1
						})
						console.log(result.data)
						res.json(result.data)
						break;
					default:
						break;
				}

				// res.json(result.rows)
				break;
			default:
				res.json([])
				break;
		}

		res.json(result.rows)
	} catch (error) {
	  console.log(error)
	  res.json(error)
	}
})
app.post('/api/chatwoot', async (req, res) => {
	console.log(req.body)
	let result=null
	try {
		let get_setting=await client.query({
			text: "SELECT * FROM crm_posts WHERE type=$1 LIMIT 1",
			values: ["setting"]
		})
		switch (req.body.type) {
			case "contacts":
				switch (req.body.option) {
					case 'search':
						result = await client.query({
							text: 'SELECT * FROM contacts WHERE (name LIKE $1 OR phone_number LIKE $1) AND account_id=$2 ORDER BY updated_at DESC',
							values: ["%"+req.body.value+"%", get_setting.rows[0].data.chatwoot_id]
						})
						res.json(result.rows)
						break;
					default:
						break;
				}
				break;
			case "inboxes":
				switch (req.body.option) {
					case 'search':
						result = await client.query({
							text: 'SELECT * FROM inboxes WHERE name LIKE $1 AND account_id=$2',
							values: ["%"+req.body.value+"%", get_setting.rows[0].data.chatwoot_id]
						})
						break;
					case 'list':
						result = await client.query({
							text: 'SELECT * FROM inboxes WHERE account_id=$1',
							values: [get_setting.rows[0].data.chatwoot_id]
						})
						break;
					default:
						break;
				}
				res.json(result.rows)
				break;
			case "media":
				switch (req.body.option) {
					case "list":
						let miarray = []
						let query = await client.query({
							text: 'SELECT * FROM conversations WHERE account_id=$1 ORDER BY updated_at DESC LIMIT $2 OFFSET $3',
							values: [get_setting.rows[0].data.chatwoot_id, req.body.limit, req.body.offset]
						})
						// console.log(query.rows)
						for (let i = 0; i < query.rows.length; i++) {
							// console.log(query.rows[i])
							let michats = await axios(get_setting.rows[0].data.chatwoot_url+'/api/v1/accounts/'+get_setting.rows[0].data.chatwoot_id+'/conversations/'+query.rows[i].display_id+'/messages', {
								headers: {
								'Content-Type': 'application/json',
								'api_access_token': get_setting.rows[0].data.chatwoot_token
								}
							})
							// console.log("-------------")
							let mimessages = michats.data.payload
							// console.log(mimessages)
							for (let index = 0; index < mimessages.length; index++) {
								if (mimessages[index].attachments) {
									miarray.push(mimessages[index].attachments[0]) 
								}
							}
						}
						res.json(miarray)
						break;
					case "conversations":
						result = await client.query({
							text: 'SELECT * FROM conversations WHERE account_id=$1 ORDER BY updated_at DESC',
							values: [get_setting.rows[0].data.chatwoot_id]
						})
						res.json(result.rows)
						break;						
					default:
						break;
				}
				break;
			default:
				break;
		}


	} catch (error) {
	  console.log(error)
	}
})

// endpoint agente IA ---------------------
app.post('/api/bot', async (req, res) => {
	console.log(req.body)
	try {
	  if (req.body.message_type == "incoming") {   
		let get_promtp = await client.query({
		  text: "SELECT * FROM crm_posts WHERE type=$1 LIMIT 1",
		  values: ["prompt"],
		})
		let get_setting = await client.query({
			text: "SELECT * FROM crm_posts WHERE type=$1 LIMIT 1",
			values: ["setting"],
		  })
		let conversation_id=req.body.conversation.id
		let contact_id=req.body.conversation.contact_inbox.contact_id
		let get_action_type = null
		if (get_promtp.rows[0].data.action_post) {
		  
		}else{
		  get_action_type = await func_search(req.body.conversation.messages[0])
		}
		
		// post---------------------------------------------
		console.log(get_action_type)
		if (get_action_type.status) {
			// cargar chats-------------------------------------
			// let midata = []
			let michats = await func_load_chat(conversation_id, get_promtp, get_setting)
			// midata = michats.data
			// count_tokens += michats.tokens
  
			//obtener el esquema del hashtag ---------------------
			// let esquema = await client.query({
			// 	text: 'SELECT * FROM crm_acciones WHERE name=$1 LIMIT 1',
			// 	values: [get_action_type.name]
			// })
			// console.log("esquema :", esquema.rows[0].json)
			// enviar todo a la api de (meta o open ai)-----------
			let ia_resp = await axios.post(url_api, 
			{
				model: get_promtp.rows[0].model,
				temperature: get_promtp.rows[0].temperature,
				top_p: get_promtp.rows[0].top_p,
				stream: false,
				messages: michats.data,
				tools: get_action_type.schema
				// functions: esquema.rows[0].json,
				// function_call: { name: esquema.rows[0].name }       
			}, 
			{ headers: { Authorization: "Bearer "+get_promtp.rows[0].token_api } })
			// console.log("Respuesta del IA: ", ia_resp.data)
	
			// actualizar tokens a la cuenta--------------------
			// count_tokens += miresp.data.usage.total_tokens
			// await client.query({
			// 	text: 'UPDATE crm_prompts SET total_tokens=$1 WHERE chatwoot_id=$2',
			// 	values: [(count_tokens+get_promtp.rows[0].total_tokens), process.env.CHATWOOT_ID]
			// })
	
			// // enviar respuesta a la funcion ----------------------
			await func_bacel(get_action_type.schema, ia_resp.data.choices[0].message.tool_calls, conversation_id, url_api, token_api, get_promtp.rows[0].model, get_promtp.rows[0].total_tokens)
		}else{
		  // console.log("chat sin ")
		  //cargar prompt system----------------------------
		  let midata = [{
			role: "system",
			content: await func_shortcode(get_promtp.rows[0].prompt, contact_id) 
		  }]
  
		  // //cargar chats-----------------------------------
		  let michats = await func_load_chat(midata, conversation_id)
		  midata = michats.data
		  count_tokens += michats.tokens
  
		  // enviar todo a la Api (meta o open ai)--------------
		  let miresp = await axios.post(url_api, 
		  {
			model: get_promtp.rows[0].model,
			max_tokens: get_promtp.rows[0].max_tokens,
			temperature: get_promtp.rows[0].temperature,
			top_p: get_promtp.rows[0].top_p,
			stream: false,
			n: 1,
			messages: midata
		  }, 
		  { headers: { Authorization: "Bearer "+token_api } })
  
		  // responder en el chat-----------------------------
		  await axios.post(process.env.CHATWOOT_URL+'/api/v1/accounts/'+process.env.CHATWOOT_ID+'/conversations/'+conversation_id+"/messages", {
			"content": miresp.data.choices[0].message.content,
			"message_type": "outgoing",
			},
			{
			headers: {
			  'Content-Type': 'application/json',
			  'api_access_token': process.env.CHATWOOT_TOKEN
			}
		  })
  
		  // actualizar tokens a la cuenta--------------------
		  count_tokens += miresp.data.usage.total_tokens
		  await client.query({
			text: 'UPDATE crm_prompts SET total_tokens=$1 WHERE chatwoot_id=$2',
			values: [(count_tokens+get_promtp.rows[0].total_tokens), process.env.CHATWOOT_ID]
		  })
		}
	  }
	  res.json(true)
	} catch (error) {
	  console.log(error)
	  res.json(true)
	}
})

async function func_search(conversation){
	let miname = ""
	let mistatus = false
	let mischema = null
	if (conversation.content) {
		let mijson = await fs.readJson(process.cwd()+"/public/schemas/post.json")
		console.log(mijson)
		for (let index = 0; index < mijson.length; index++) {
			if (conversation.content.indexOf(mijson[index].name) != -1 ) {
				miname = mijson[index].name
				mistatus = true
				mischema = mijson[index]
				break;
			}
		}
		return {
			status: mistatus,
			name: miname,
			schema: mischema
		}
	}else{
	  return {
		status: mistatus,
		name: miname,
		schema: mischema
	  }
	}
}

async function func_load_chat(conversation_display, get_promtp, get_setting){
	//cargando los ultimos 20 chats
	let midata = []
	let michats = await axios(get_setting.rows[0].data.chatwoot_url+'/api/v1/accounts/'+get_setting.rows[0].data.chatwoot_id+'/conversations/'+conversation_display+'/messages', {
	  headers: {
		'Content-Type': 'application/json',
		'api_access_token': get_setting.rows[0].data.chatwoot_token
	  }
	})
	let mimessages=michats.data.payload
	let miresp=null
	let count_tokens=0
	for (let index = 0; index < mimessages.length; index++) {
	  if (mimessages[index].sender) {
		let mirole = (mimessages[index].sender.type == "contact") ? "user" : "assistant"
		let mitext=""
		if (mimessages[index].attachments) {
		//   console.log(mimessages[index].attachments[0].file_type)
		  switch (mimessages[index].attachments[0].file_type) {
			case 'audio':
			  let downloader = new Downloader({
				url: mimessages[index].attachments[0].data_url,
				directory: "./",
				fileName: "audio.ogg",
				cloneFiles : false
			  })
			  await downloader.download()
			  miresp = await axios.post(process.env.OPENAI_URL_AUDIO, 
			  {
				model: process.env.OPENAI_MODEL_AUDIO,
				// max_tokens: 128,
				file: fs.createReadStream("audio.ogg")
			  }, 
			  { 
				headers: { 
				  "Authorization": "Bearer "+get_promtp.rows[0].data.token_api,
				  "Content-Type": "multipart/form-data"
				}
			  })
			  // console.log(miresp.data)
			  mitext="Audio adjuntado: "+miresp.data.text
			  // count_tokens+=miresp.data.usage.total_tokens
			  break;
			case 'image':        
			  let image64 = await encode(mimessages[index].attachments[0].data_url, {string: true});
			  miresp = await axios.post(process.env.OPENAI_URL_CHAT, 
			  {
				model: get_promtp.rows[0].data.model,
				max_tokens: get_promtp.rows[0].data.max_tokens,
				n: get_promtp.rows[0].data.n,
				messages: [{
				  role: "user",
				  content: [
					{
					  type: "text",
					  text: get_promtp.rows[0].data.prompt_image
					},
					{
					  type: "image_url",
					  image_url: {
						  url: "data:image/jpeg;base64,"+image64
					  }
					}
				  ]
				}]
			  }, 
			  { headers: { Authorization: "Bearer "+get_promtp.rows[0].data.token_api } })
			  
			//   console.log(miresp.data.choices[0].message)
			  mitext="Imagen adjuntada: "+ miresp.data.choices[0].message.content
			  count_tokens+=miresp.data.usage.total_tokens
			  break;
			case 'file':
			  switch (mimessages[index].attachments[0].data_url.split('.').pop()) {
				case "pdf":
				  mitext="PDF adjunto: "+mimessages[index].attachments[0].data_url.replace(/^.*[\\\/]/, '')
				  break;
				case "apk":
				  mitext="APK adjunto: "+mimessages[index].attachments[0].data_url.replace(/^.*[\\\/]/, '')
				  break;
				default:
				  mitext="archivo desconocido adjunto: "+mimessages[index].attachments[0].data_url.replace(/^.*[\\\/]/, '')
				  break;
			  }
			  break;
			case 'video':
			  mitext="Video adjunto: "+mimessages[index].attachments[0].data_url.replace(/^.*[\\\/]/, '')
			  break;
			default:
			  break;
		  }
		}
		midata.push({
		  role: mirole,
		  content: mimessages[index].content+"\n"+mitext
		})
	  }
	}
	return {
	  data: midata,
	  tokens: count_tokens
	}
}

app.post('/api/webhook', async (req, res) => {
	console.log(req.body)
	try {
		let miphone = req.body.billing.phone
		let miname = req.body.billing.first_name+" "+req.body.billing.last_name
		let miid = req.body.id
		let mimeta = req.body.meta_data 
		let miexpires = null
		let mimessage = null
		let get_setting=await client.query({
			text: "SELECT * FROM crm_posts WHERE type=$1 LIMIT 1",
			values: ["setting"]
		})
		for (let index = 0; index < mimeta.length; index++) {
			switch (mimeta[index].key) {
				case "expires":
					miexpires = mimeta[index].value
					break;
				case "credentials":
					mimessage = mimeta[index].value
					break;
				case "message":
					mimessage = mimeta[index].value
					break;
				default:
					break;
			}
		}
		let midata = {
			"end": miexpires+"T00:00",
			"start": miexpires+"T00:00",
			"title": "venta #"+miid,
			"allDay": true,
			"message": mimessage,
			"id_external": miid,
			"contact_name": miname,
			"contact_phone": miphone+get_setting.rows[0].data.whatsapp_code,
			"whatsapp": get_setting.rows[0].data.whatsapp_default
		}
		let mivery = await client.query({
			text: "SELECT * FROM crm_posts WHERE id_external=$1",
			values: [miid]
		})
		// console.log(mivery.rows.length)
		if (mivery.rows.length == 0 && miexpires != null) {
			await client.query({
				text: 'INSERT INTO crm_posts(type, data, id_external) VALUES($1, $2, $3)',
				values: ["calendar", midata, miid]
			})
		}
	} catch (error) {
		console.log(error)
	}

	res.json(req.body)
})

app.post('/api/send', async (req, res) => {
	console.log(req.body)
	// let micontact = await client.query({
	// 	text: 'SELECT * FROM contacts WHERE id=$1',
	// 	values: [req.body.contact_id]
	// })
	// console.log(micontact.rows)

	if (req.body.data_url) {
		await axios.request({
			method: 'post',
			maxBodyLength: Infinity,
			url: process.env.EVOLUTION_URL+'/message/sendMedia/'+req.body.whatsapp,
			headers: {
				'Content-type': 'application/json',
				'apikey': process.env.EVOLUTION_TOKEN,
			},
			data : JSON.stringify({
				number: req.body.identifier,
				options: {
					delay: 1200,
					presence: 'composing'
				},
				mediaMessage: {
					mediatype: req.body.file_type,
					caption: req.body.message,
					media: req.body.data_url
				}
			})
		})
		.then(async (response) => {
			// console.log(response.data)
			res.json(response.data) 
		})
		.catch((error) => {
			console.log(error)
		})
	} else {
		let config = {
			method: 'post',
			maxBodyLength: Infinity,
			url: process.env.EVOLUTION_URL+'/message/sendText/'+req.body.whatsapp,
			headers: {
			  'Content-type': 'application/json',
			  'apikey': process.env.EVOLUTION_TOKEN,
			},
			data : JSON.stringify({
			  number: micontact.rows[0].identifier,
			  options: {
				delay: 1200,
				presence: 'composing'
			  },
			  textMessage: {
				text: req.body.message,
			  }
			})
		}
		await axios.request(config)
		.then(async (response) => {
			console.log(response.data)
			res.json(response.data)
		})
		.catch((error) => {
			// console.log(error)
		})
	}
})

// Init server ----------------------------
server.listen(3010, () => {
	console.log('server run in port: 3010')
})
