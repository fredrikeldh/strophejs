/*
	This program is distributed under the terms of the MIT license.
	Please see the LICENSE file for details.

	Copyright 2006-2008, OGG, LLC
*/

/* jshint undef: true, unused: true:, noarg: true, latedef: true */
/*global document, window, clearTimeout,
	DOMParser, Strophe, $build */

/** Class: Strophe.Chromesocket
 *  _Private_ helper class that handles chrome.sockets.tcp Connections
 *
 *  The Strophe.Chromesocket class is used internally by Strophe.Connection
 *  to encapsulate chrome.sockets.tcp sessions. It is not meant to be used from user's code.
 */

/** File: chromesocket.js
 *  A JavaScript library to enable XMPP over TCP in Strophejs.
 *
 *  This file implements XMPP over TCP for Strophejs.
 *  If a Connection is established with a tcp url (tcp://...)
 *  Strophe will use Chromesocket.
 *  For more information on XMPP see RFC:
 *  https://tools.ietf.org/html/rfc3920
 *
 *  ChromeSocket support implemented by Fredrik Eldh (fredrik.eldh@evothings.com)
 *  Adapted from Strophe.Websocket, implemented by Andreas Guth (andreas.guth@rwth-aachen.de)
 */

/** PrivateConstructor: Strophe.Chromesocket
 *  Create and initialize a Strophe.Chromesocket object.
 *  Currently only sets the connection Object.
 *
 *  Parameters:
 *	(Strophe.Connection) connection - The Strophe.Connection that will use Chromesocket.
 *
 *  Returns:
 *	A new Strophe.Chromesocket object.
 */
Strophe.Chromesocket = function(connection) {

	console.log("Strophe.Chromesocket constructed.");

	this._conn = connection;
	this.strip = "stream:stream";

	var service = connection.service;
	if (service.indexOf("tcp:") !== 0) {
		// If the service is not an absolute URL, assume it is a path and put the absolute
		// URL together from options, current URL and the path.
		var new_service = "tcp";

		new_service += "://" + window.location.host;

		if (service.indexOf("/") !== 0) {
			new_service += window.location.pathname + service;
		} else {
			new_service += service;
		}

		connection.service = new_service;
	}
};

Strophe.Chromesocket.prototype = {
	/** PrivateFunction: _buildStream
	 *  _Private_ helper function to generate the <stream> start tag for Chromesocket
	 *
	 *  Returns:
	 *	A Strophe.Builder with a <stream> element.
	 */
	_buildStream: function ()
	{
		return $build("stream:stream", {
			"to": this._conn.domain,
			"xmlns": Strophe.NS.CLIENT,
			"xmlns:stream": Strophe.NS.STREAM,
			"version": '1.0'
		});
	},

	/** PrivateFunction: _check_streamerror
	 * _Private_ checks a message for stream:error
	 *
	 *  Parameters:
	 *	(Strophe.Request) bodyWrap - The received stanza.
	 *	connectstatus - The ConnectStatus that will be set on error.
	 *  Returns:
	 *	 true if there was a streamerror, false otherwise.
	 */
	_check_streamerror: function (bodyWrap, connectstatus) {
		var errors = bodyWrap.getElementsByTagNameNS(Strophe.NS.STREAM, "error");
		if (errors.length === 0) {
			return false;
		}
		var error = errors[0];

		var condition = "";
		var text = "";

		var ns = "urn:ietf:params:xml:ns:xmpp-streams";
		for (var i = 0; i < error.childNodes.length; i++) {
			var e = error.childNodes[i];
			if (e.getAttribute("xmlns") !== ns) {
				break;
			} if (e.nodeName === "text") {
				text = e.textContent;
			} else {
				condition = e.nodeName;
			}
		}

		var errorString = "Chromesocket stream error: ";

		if (condition) {
			errorString += condition;
		} else {
			errorString += "unknown";
		}

		if (text) {
			errorString += " - " + condition;
		}

		Strophe.error(errorString);

		// close the connection on stream_error
		this._conn._changeConnectStatus(connectstatus, condition);
		this._conn._doDisconnect();
		return true;
	},

	/** PrivateFunction: _reset
	 *  Reset the connection.
	 *
	 *  This function is called by the reset function of the Strophe Connection.
	 *  Is not needed by Chromesocket.
	 */
	_reset: function ()
	{
		return;
	},

	/** PrivateFunction: _connect
	 *  _Private_ function called by Strophe.Connection.connect
	 *
	 *  Creates a socket for a connection and assigns Callbacks to it.
	 *  Does nothing if there already is a socket.
	 */
	_connect: function () {
		// Ensure that there is no open socket from a previous Connection.
		this._closeSocket();

		// Create the new socket
		/*this.socket = new WebSocket(this._conn.service, "xmpp");
		this.socket.onopen = this._onOpen.bind(this);
		this.socket.onerror = this._onError.bind(this);
		this.socket.onclose = this._onClose.bind(this);
		this.socket.onmessage = this._connect_cb_wrapper.bind(this);*/
		var self = this;

		this._wrote_starttls = false;
		this._finished_starttls = false;
		this._started_starttls = false;

		chrome.sockets.tcp.create({}, function(createInfo)
		{
			self.socketId = createInfo.socketId;
			var hostname = self._conn.service.substr(6);
			console.log("hostname: "+hostname);
			var port = 5222;	// XMPP standard
			console.log("port: "+port);
			chrome.sockets.tcp.connect(
				self.socketId,
				hostname,
				port,
				function(resultCode)
				{
					console.log("connect result: "+resultCode);
					self._onOpen();
					self._receiveFunction = self._connect_cb_wrapper;
					//console.log("listener: "+self._onReceive);
					self.onReciever = self._onReceive.bind(self);
					self.onRecieverError = self._onReceiveError.bind(self);
					chrome.sockets.tcp.onReceive.addListener(self.onReciever);
					chrome.sockets.tcp.onReceiveError.addListener(self.onRecieverError);
				}
			)
		});
	},

	_bufferToString: function(buffer) {
		return String.fromCharCode.apply(null, new Uint8Array(buffer))
	},

	_stringToBuffer: function(string) {
		var buffer = new ArrayBuffer(string.length)
		var bufferView = new Uint8Array(buffer);
		for (var i = 0; i < string.length; ++i)
		{
			bufferView[i] = string.charCodeAt(i) //string[i]
		}
		return buffer
	},

	_write: function(string) {
		//console.log("write "+string.length);
		//console.log(string);
		chrome.sockets.tcp.send(this.socketId, this._stringToBuffer(string), function(sendInfo) {
			//console.log("sendInfo: "+sendInfo.resultCode+" "+sendInfo.bytesSent);
		});
	},

	_receiveBuffer: false,

	// returns the length of the valid xml in the string.
	// returns false if the string is not (yet) valid xml.
	_stringIsValidXml: function(string) {
		var startIndex = 0;
		var endOfStartTag;
		var startTag;
		while(true) {
			startIndex = string.indexOf('<', startIndex);
			if(startIndex < 0) {
				console.log("no startIndex");
				return false;
			}
			// skip XML declarations.
			console.log(string.charAt(startIndex+1));
			if(string.charAt(startIndex+1) == '?') {
				startIndex = startIndex+1;
			} else {
				endOfStartTag = string.indexOf('>', startIndex);
				if(endOfStartTag <= 0) {
					console.log("no end of start tag");
					return false;
				}
				if(string.charAt(endOfStartTag-1) == '/') {
					// empty tag
					console.log("empty tag");
					return endOfStartTag+1;
				}
				var spaceIndex = string.indexOf(' ', startIndex);
				if(spaceIndex > 0 && spaceIndex < endOfStartTag) {
					endOfStartTag = spaceIndex;
				}
				startTag = string.substring(startIndex+1, endOfStartTag);
				if(startTag == 'stream:stream') {
					startIndex = endOfStartTag;
					continue;
				}
				break;
			}
		}
		var endTag = '</'+startTag+'>';
		var endIndex = string.indexOf(endTag);
		if(endIndex > 0) {
			return endIndex + endTag.length;
		} else {
			console.log("not valid xml; looking for \""+endTag+"\"");
			return false;
		}
	},

	_onReceive: function(readInfo) {
		if(readInfo.socketId != this.socketId)
			return;
		//console.log("_onReceive "+readInfo.data.byteLength);
		// Interpret ArrayBuffer as UTF-8 string and convert to JavaScript string, wrapped in a MessageEvent.
		var string = this._bufferToString(readInfo.data);
		console.log("_onReceive: "+string);

		// Make sure we send only complete XML documents.
		// Save the string of incomplete documents.
		// Abort app on error.
		if(!this._receiveBuffer) {
			this._receiveBuffer = string;
		} else {
			this._receiveBuffer += string;
		}
		while(this._receiveBuffer) {
			string = this._receiveBuffer;
			var length = this._stringIsValidXml(string);
			if(length) {
				if(string.length == length) {
					this._receiveBuffer = false;
				} else {
					// If the xml ended before the string did,
					// assume the rest is a new xml document. Save it for later.
					this._receiveBuffer = string.substring(length);
					string = string.substr(0, length);
				}
				console.log("_receiveFunction: "+string);
				this._receiveFunction({data:string});
			} else {
				break;
			}
		}
	},

	_onReceiveError: function(errorInfo) {
		if(readInfo.socketId != this.socketId)
			return;
		console.log("_onReceiveError "+errorInfo.resultCode);
		/*if(readInfo.resultCode == 0) {
			// assume code 0 means "connection closed by remote peer"
			self._onClose();
			return;
		}*/
		if(errorInfo.resultCode < 0) {
			this._onError(errorInfo.resultCode);
			return;
		}
	},

	_wrote_starttls: false,
	_finished_starttls: false,
	_started_starttls: false,

	_doProceed: function() {
		console.log("calling secure...");
		var self = this;
		this._started_starttls = true;
		chrome.sockets.tcp.secure(this.socketId, {tlsVersion:{min:'tls1.2'}}, function(result) {
			console.log("secure result: "+result);

//5.1.10. If the TLS negotiation is successful, the initiating entity MUST
//        discard any knowledge obtained in an insecure manner from the
//        receiving entity before TLS takes effect.

			//self._conn._connect_cb(self._starttls_body);

			// at this point, we need to resend the initial stream.
//5.2.7. If the TLS negotiation is
//       successful, the initiating entity MUST initiate a new stream by
//       sending an opening XML stream header to the receiving entity.

			self._write("<stream:stream to='"+self._conn.domain+
				"' xmlns='jabber:client' xmlns:stream='http://etherx.jabber.org/streams' version='1.0'>");
			self._receiveFunction = self._connect_cb_wrapper;

			self._finished_starttls = true;
		});
	},

	/** PrivateFunction: _connect_cb
	 *  _Private_ function called by Strophe.Connection._connect_cb
	 *
	 * checks for stream:error
	 * performs starttls, if needed.
	 *
	 *  Parameters:
	 *	(Strophe.Request) bodyWrap - The received stanza.
	 */
	_connect_cb: function(bodyWrap) {
		var error = this._check_streamerror(bodyWrap, Strophe.Status.CONNFAIL);
		if (error) {
			return Strophe.Status.CONNFAIL;
		}

		if(this._finished_starttls) {
			return;
		}

		// Check for the starttls tag
		var hasStarttls = false;//bodyWrap.getElementsByTagName("starttls").length > 0;
		//console.log("testing starttls...");
		if(hasStarttls && !this._wrote_starttls) {
			this._write("<starttls xmlns='urn:ietf:params:xml:ns:xmpp-tls'/>");
			console.log("wrote <starttls>");
			this._wrote_starttls = true;
			this._starttls_body = bodyWrap;
			return Strophe.Status.STARTTLS;
		}

		// Check for the proceed tag
		var hasProceed = bodyWrap.getElementsByTagName("proceed").length > 0 || bodyWrap.tagName == "proceed";
		//console.log("testing proceed: "+bodyWrap.tagName);
		if(hasProceed) {
			this._doProceed();
			return Strophe.Status.STARTTLS;
		}
	},

	/** PrivateFunction: _handleStreamStart
	 * _Private_ function that checks the opening stream:stream tag for errors.
	 *
	 * Disconnects if there is an error and returns false, true otherwise.
	 *
	 *  Parameters:
	 *	(Node) message - Stanza containing the stream:stream.
	 */
	_handleStreamStart: function(message) {
		//console.log("_handleStreamStart");
		var error = false;
		// Check for errors in the stream:stream tag
		var ns = message.getAttribute("xmlns");
		if (typeof ns !== "string") {
			error = "Missing xmlns in stream:stream";
		} else if (ns !== Strophe.NS.CLIENT) {
			error = "Wrong xmlns in stream:stream: " + ns;
		}

		var ns_stream = message.namespaceURI;
		if (typeof ns_stream !== "string") {
			error = "Missing xmlns:stream in stream:stream";
		} else if (ns_stream !== Strophe.NS.STREAM) {
			error = "Wrong xmlns:stream in stream:stream: " + ns_stream;
		}

		var ver = message.getAttribute("version");
		if (typeof ver !== "string") {
			error = "Missing version in stream:stream";
		} else if (ver !== "1.0") {
			error = "Wrong version in stream:stream: " + ver;
		}

		if (error) {
			this._conn._changeConnectStatus(Strophe.Status.CONNFAIL, error);
			this._conn._doDisconnect();
			return false;
		}

		return true;
	},

	/** PrivateFunction: _connect_cb_wrapper
	 * _Private_ function that handles the first connection messages.
	 *
	 * On receiving an opening stream tag this callback replaces itself with the real
	 * message handler. On receiving a stream error the connection is terminated.
	 */
	_connect_cb_wrapper: function(message) {
		if (message.data.indexOf("<stream:stream ") === 0 || message.data.indexOf("<?xml") === 0) {
			// Add the XML Declaration, if there isn't one.
			var data = message.data;
			//if(data.indexOf("<?xml") !== 0) {
				data = "<?xml version='1.0' ?>"+data;
			//}

			//console.log("_connect_cb_wrapper 1");

			//Make the initial stream:stream selfclosing to parse it without a SAX parser.
			//remove any data following the stream:stream tag
			data = message.data.replace(/<stream:stream (.*?[^\/])>.*/, "<stream:stream $1/>");

			var streamStart = new DOMParser().parseFromString(data, "text/xml").documentElement;
			this._conn.xmlInput(streamStart);
			this._conn.rawInput(message.data);

			//console.log("_connect_cb_wrapper 2");

			//_handleStreamSteart will check for XML errors and disconnect on error
			if (this._handleStreamStart(streamStart)) {

				//_connect_cb will check for stream:error and disconnect on error
				//console.log("calling _connect_cb 1...");
				this._connect_cb(streamStart);

				// ensure received stream:stream is NOT selfclosing and save it for following messages
				this.streamStart = message.data.replace(/^<stream:(.*)\/>$/, "<stream:$1>");

				//handle any data following the stream:stream tag.
				data = message.data.replace(/.*<stream:stream .*?[^\/]>(.*)/, "$1");
				if (data.length > 0) {
					console.log('data following stream:stream tag present. calling _connect_cb_wrapper.')
					this._connect_cb_wrapper({data: data});
				}

			}
		} else if (message.data === "</stream:stream>") {
			this._conn.rawInput(message.data);
			this._conn.xmlInput(document.createElement("stream:stream"));
			this._conn._changeConnectStatus(Strophe.Status.CONNFAIL, "Received closing stream");
			this._conn._doDisconnect();
			return;
		} else {
			var string = this._streamWrap(message.data);
			var elem = new DOMParser().parseFromString(string, "text/xml").documentElement;
			this._receiveFunction = this._onMessage.bind(this);
			this._conn._connect_cb(elem, null, message.data);
		}
	},

	/** PrivateFunction: _disconnect
	 *  _Private_ function called by Strophe.Connection.disconnect
	 *
	 *  Disconnects and sends a last stanza if one is given
	 *
	 *  Parameters:
	 *	(Request) pres - This stanza will be sent before disconnecting.
	 */
	_disconnect: function (pres)
	{
		console.log("ChromeSocket._disconnect("+pres+") called");
		if (this.socketId) {
			if (pres) {
				this._conn.send(pres);
			}
			var close = '</stream:stream>';
			this._conn.xmlOutput(document.createElement("stream:stream"));
			this._conn.rawOutput(close);
			try {
				this._write(close);
			} catch (e) {
				Strophe.info("Couldn't send closing stream tag.");
			}
		}

		this._conn._doDisconnect();
	},

	/** PrivateFunction: _doDisconnect
	 *  _Private_ function to disconnect.
	 *
	 *  Just closes the socket.
	 */
	_doDisconnect: function ()
	{
		Strophe.info("Chromesockets _doDisconnect was called");
		this._closeSocket();
	},

	/** PrivateFunction _streamWrap
	 *  _Private_ helper function to wrap a stanza in a <stream> tag.
	 *  This is used so Strophe can process stanzas from sockets like BOSH
	 */
	_streamWrap: function (stanza)
	{
		return this.streamStart + stanza + '</stream:stream>';
	},


	/** PrivateFunction: _closeSocket
	 *  _Private_ function to close the socket.
	 *
	 *  Closes the socket if it is still open and deletes it
	 */
	_closeSocket: function ()
	{
		if (this.socketId) { try {
			console.log("closing socket...");
			chrome.sockets.tcp.close(this.socketId);
			chrome.sockets.tcp.onReceive.removeListener(this.onReciever);
			chrome.sockets.tcp.onReceiveError.removeListener(this.onRecieverError);
			console.log("socket listeners removed.");
		} catch (e) { console.log(e); } }
		this.socketId = null;
	},

	/** PrivateFunction: _emptyQueue
	 * _Private_ function to check if the message queue is empty.
	 *
	 *  Returns:
	 *	True, because socket messages are send immediately after queueing.
	 */
	_emptyQueue: function ()
	{
		return true;
	},

	/** PrivateFunction: _onClose
	 * _Private_ function to handle Chromesocket closing.
	 *
	 * Not much to do here.
	 */
	_onClose: function() {
		if(this._conn.connected && !this._conn.disconnecting) {
			Strophe.error("Chromesocket closed unexcectedly");
			this._conn._doDisconnect();
		} else {
			Strophe.info("Chromesocket closed");
		}
	},

	/** PrivateFunction: _no_auth_received
	 *
	 * Called on stream start/restart when no stream:features
	 * has been received.
	 */
	_no_auth_received: function (_callback)
	{
		Strophe.error("Server did not send any auth methods");
		this._conn._changeConnectStatus(Strophe.Status.CONNFAIL, "Server did not send any auth methods");
		if (_callback) {
			_callback = _callback.bind(this._conn);
			_callback();
		}
		this._conn._doDisconnect();
	},

	/** PrivateFunction: _onDisconnectTimeout
	 *  _Private_ timeout handler for handling non-graceful disconnection.
	 *
	 *  This does nothing for Chromesocket
	 */
	_onDisconnectTimeout: function () {},

	/** PrivateFunction: _onError
	 * _Private_ function to handle Chromesocket errors.
	 *
	 * Parameters:
	 * (Object) error - The Chromesocket error.
	 */
	_onError: function(error) {
		Strophe.error("Chromesocket error " + error);
		this._conn._changeConnectStatus(Strophe.Status.CONNFAIL, "The Chromesocket connection could not be established or was disconnected.");
		this._disconnect();
	},

	/** PrivateFunction: _onIdle
	 *  _Private_ function called by Strophe.Connection._onIdle
	 *
	 *  sends all queued stanzas
	 */
	_onIdle: function () {
		var data = this._conn._data;
		if (data.length > 0 && !this._conn.paused) {
			for (var i = 0; i < data.length; i++) {
				if (data[i] !== null) {
					var stanza, rawStanza;
					if (data[i] === "restart") {
						stanza = this._buildStream();
						rawStanza = this._removeClosingTag(stanza);
						stanza = stanza.tree();
					} else {
						stanza = data[i];
						rawStanza = Strophe.serialize(stanza);
					}
					this._conn.xmlOutput(stanza);
					this._conn.rawOutput(rawStanza);
					this._write(rawStanza);
				}
			}
			this._conn._data = [];
		}
	},

	/** PrivateFunction: _onMessage
	 * _Private_ function to handle socket messages.
	 *
	 * This function parses each of the messages as if they are full documents. [TODO : We may actually want to use a SAX Push parser].
	 *
	 * Since all XMPP traffic starts with "<stream:stream version='1.0' xml:lang='en' xmlns='jabber:client' xmlns:stream='http://etherx.jabber.org/streams' id='3697395463' from='SERVER'>"
	 * The first stanza will always fail to be parsed...
	 * Addtionnaly, the seconds stanza will always be a <stream:features> with the stream NS defined in the previous stanza... so we need to 'force' the inclusion of the NS in this stanza!
	 *
	 * Parameters:
	 * (string) message - The socket message.
	 */
	_onMessage: function(message) {
		var elem, data, extraData;
		if(this._started_starttls && !this._finished_starttls) {
			console.log("ignore message...");
			return;
		}
		// check for closing stream
		if (message.data === "</stream:stream>") {
			var close = "</stream:stream>";
			this._conn.rawInput(close);
			this._conn.xmlInput(document.createElement("stream:stream"));
			if (!this._conn.disconnecting) {
				this._conn._doDisconnect();
			}
			return;
		} else if (message.data.indexOf("<proceed ") >= 0) {
			this._doProceed();
			return;
		} else if (message.data.search("<stream:stream ") != -1) {
			//Make the initial stream:stream selfclosing to parse it without a SAX parser.
			//remove any data following the stream:stream tag
			data = message.data.replace(/<stream:stream (.*?[^\/])>.*/, "<stream:stream $1/>");
			elem = new DOMParser().parseFromString(data, "text/xml").documentElement;

			if (!this._handleStreamStart(elem)) {
				return;
			}

			//handle any data following the stream:stream tag.
			data = message.data.replace(/.*<stream:stream .*?[^\/]>(.*)/, "$1");
			if (data.length > 0) {
				elem = new DOMParser().parseFromString(data, "text/xml").documentElement;
				extraData = data;
			}

			// ensure received stream:stream is NOT selfclosing and save it for following messages
			this.streamStart = message.data.replace(/^<stream:(.*)\/>$/, "<stream:$1>");
		} else {
			data = this._streamWrap(message.data);
			elem = new DOMParser().parseFromString(data, "text/xml").documentElement;
		}

		if (this._check_streamerror(elem, Strophe.Status.ERROR)) {
			return;
		}

		//handle unavailable presence stanza before disconnecting
		if (this._conn.disconnecting &&
				elem.firstChild.nodeName === "presence" &&
				elem.firstChild.getAttribute("type") === "unavailable") {
			this._conn.xmlInput(elem);
			this._conn.rawInput(Strophe.serialize(elem));
			// if we are already disconnecting we will ignore the unavailable stanza and
			// wait for the </stream:stream> tag before we close the connection
			return;
		}
		this._conn._dataRecv(elem, message.data);

		if (extraData != null) {
			//console.log('data following stream:stream tag present. calling _onMessage.')
			this._onMessage({data: extraData});
		}
	},

	/** PrivateFunction: _onOpen
	 * _Private_ function to handle socket connection setup.
	 *
	 * The opening stream tag is sent here.
	 */
	_onOpen: function() {
		Strophe.info("Chromesocket open");
		var start = this._buildStream();
		this._conn.xmlOutput(start.tree());

		var startString = this._removeClosingTag(start);
		this._conn.rawOutput(startString);
		this._write("<?xml version='1.0' ?>"+startString);
	},

	/** PrivateFunction: _removeClosingTag
	 *  _Private_ function to Make the first <stream:stream> non-selfclosing
	 *
	 *  Parameters:
	 *	  (Object) elem - The <stream:stream> tag.
	 *
	 *  Returns:
	 *	  The stream:stream tag as String
	 */
	_removeClosingTag: function(elem) {
		var string = Strophe.serialize(elem);
		string = string.replace(/<(stream:stream .*[^\/])\/>$/, "<$1>");
		return string;
	},

	/** PrivateFunction: _reqToData
	 * _Private_ function to get a stanza out of a request.
	 *
	 * sockets don't use requests, so the passed argument is just returned.
	 *
	 *  Parameters:
	 *	(Object) stanza - The stanza.
	 *
	 *  Returns:
	 *	The stanza that was passed.
	 */
	_reqToData: function (stanza)
	{
		return stanza;
	},

	/** PrivateFunction: _send
	 *  _Private_ part of the Connection.send function for Chromesocket
	 *
	 * Just flushes the messages that are in the queue
	 */
	_send: function () {
		this._conn.flush();
	},

	/** PrivateFunction: _sendRestart
	 *
	 *  Send an xmpp:restart stanza.
	 */
	_sendRestart: function ()
	{
		clearTimeout(this._conn._idleTimeout);
		this._conn._onIdle.bind(this._conn)();
	}
};
