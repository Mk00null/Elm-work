/*
 * Vidar: minimal Jellyfin REST client (no extra dependencies).
 * Licensed under the Apache License, Version 2.0.
 */
package com.google.jetstream.data.jellyfin

import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

@Serializable
data class JfAuthResult(
    @SerialName("AccessToken") val accessToken: String,
    @SerialName("User") val user: JfUser
)

@Serializable
data class JfUser(@SerialName("Id") val id: String)

@Serializable
data class JfItems(@SerialName("Items") val items: List<JfItem> = emptyList())

@Serializable
data class JfPerson(
    @SerialName("Id") val id: String = "",
    @SerialName("Name") val name: String = "",
    @SerialName("Role") val role: String? = null,
    @SerialName("Type") val type: String? = null
)

@Serializable
data class JfUserData(
    @SerialName("PlaybackPositionTicks") val positionTicks: Long = 0,
    @SerialName("IsFavorite") val isFavorite: Boolean = false
)

@Serializable
data class JfItem(
    @SerialName("Id") val id: String,
    @SerialName("Name") val name: String = "",
    @SerialName("Type") val type: String = "",
    @SerialName("Overview") val overview: String? = null,
    @SerialName("OfficialRating") val officialRating: String? = null,
    @SerialName("PremiereDate") val premiereDate: String? = null,
    @SerialName("ProductionYear") val year: Int? = null,
    @SerialName("RunTimeTicks") val runTimeTicks: Long? = null,
    @SerialName("Genres") val genres: List<String> = emptyList(),
    @SerialName("People") val people: List<JfPerson> = emptyList(),
    @SerialName("CommunityRating") val communityRating: Double? = null,
    @SerialName("UserData") val userData: JfUserData? = null,
    @SerialName("SeriesName") val seriesName: String? = null
)

/** Connection settings; filled from res/values/vidar_config.xml. */
data class JellyfinConfig(
    val serverUrl: String,
    val username: String,
    val password: String,
    val deviceName: String = "Vidar TV"
) {
    val enabled get() = serverUrl.isNotBlank() && username.isNotBlank()
}

class JellyfinClient(private val config: JellyfinConfig) {
    private val json = Json { ignoreUnknownKeys = true; coerceInputValues = true }
    private val deviceId = UUID.nameUUIDFromBytes(config.username.toByteArray()).toString()
    private val lock = Mutex()
    private var token: String? = null
    private var userId: String? = null

    val base: String get() = config.serverUrl.trimEnd('/')

    private fun authHeader(): String =
        "MediaBrowser Client=\"Vidar TV\", Device=\"${config.deviceName}\", " +
            "DeviceId=\"$deviceId\", Version=\"1.0.0\"" + (token?.let { ", Token=\"$it\"" } ?: "")

    private fun request(method: String, path: String, body: String? = null): String {
        val conn = URL(base + path).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = 8000
            conn.readTimeout = 15000
            conn.setRequestProperty("Authorization", authHeader())
            conn.setRequestProperty("Accept", "application/json")
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(body.toByteArray()) }
            }
            val code = conn.responseCode
            if (code !in 200..299) {
                throw JellyfinException("Jellyfin $method $path failed: HTTP $code")
            }
            return conn.inputStream.bufferedReader().use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }

    private suspend fun ensureLogin() = lock.withLock {
        if (token != null) return@withLock
        val body = buildJsonObject {
            put("Username", config.username)
            put("Pw", config.password)
        }.toString()
        val res = json.decodeFromString<JfAuthResult>(request("POST", "/Users/AuthenticateByName", body))
        token = res.accessToken
        userId = res.user.id
    }

    private suspend fun get(path: String): String = withContext(Dispatchers.IO) {
        ensureLogin()
        request("GET", path.replace("{user}", userId!!))
    }

    private val fields = "Overview,Genres,People,OfficialRating,PremiereDate,CommunityRating"

    suspend fun items(query: String): List<JfItem> =
        json.decodeFromString<JfItems>(
            get("/Users/{user}/Items?Recursive=true&Fields=$fields&$query")
        ).items

    suspend fun latest(limit: Int = 20): List<JfItem> =
        json.decodeFromString<List<JfItem>>(
            get("/Users/{user}/Items/Latest?Limit=$limit&IncludeItemTypes=Movie,Series&Fields=$fields")
        )

    suspend fun resume(limit: Int = 20): List<JfItem> =
        json.decodeFromString<JfItems>(
            get("/Users/{user}/Items/Resume?Limit=$limit&Fields=$fields")
        ).items

    suspend fun item(id: String): JfItem =
        json.decodeFromString(get("/Users/{user}/Items/$id?Fields=$fields"))

    suspend fun genres(): List<JfItem> =
        json.decodeFromString<JfItems>(
            get("/Genres?UserId={user}&IncludeItemTypes=Movie,Series&SortBy=SortName")
        ).items

    fun enc(s: String): String = URLEncoder.encode(s, "UTF-8")

    fun imageUrl(id: String, type: String = "Primary", width: Int = 480) =
        "$base/Items/$id/Images/$type?maxWidth=$width&quality=90"

    /** Direct-play when possible, otherwise the server transcodes (HLS). */
    fun streamUrl(id: String): String =
        "$base/Videos/$id/stream?static=true&api_key=${token.orEmpty()}"

    fun subtitleUrl(id: String): String =
        "$base/Videos/$id/$id/Subtitles/0/0/Stream.vtt?api_key=${token.orEmpty()}"
}

class JellyfinException(message: String) : Exception(message)
