/*
 * Vidar: MovieRepository backed by a Jellyfin server.
 * Licensed under the Apache License, Version 2.0.
 */
package com.google.jetstream.data.jellyfin

import com.google.jetstream.data.entities.Movie
import com.google.jetstream.data.entities.MovieCast
import com.google.jetstream.data.entities.MovieCategory
import com.google.jetstream.data.entities.MovieCategoryDetails
import com.google.jetstream.data.entities.MovieCategoryList
import com.google.jetstream.data.entities.MovieDetails
import com.google.jetstream.data.entities.MovieList
import com.google.jetstream.data.repositories.MovieRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow

class JellyfinMovieRepository(private val jf: JellyfinClient) : MovieRepository {

    private fun JfItem.toMovie(landscape: Boolean = false) = Movie(
        id = id,
        videoUri = jf.streamUrl(id),
        subtitleUri = null,
        posterUri = jf.imageUrl(id, if (landscape) "Backdrop" else "Primary", if (landscape) 1280 else 480),
        name = if (seriesName != null && type == "Episode") "$seriesName · $name" else name,
        description = overview.orEmpty()
    )

    private fun list(block: suspend () -> List<JfItem>, landscape: Boolean = false): Flow<MovieList> =
        flow { emit(runCatching { block() }.getOrDefault(emptyList()).map { it.toMovie(landscape) }) }

    override fun getFeaturedMovies() = list({ jf.latest(8) }, landscape = true)
    override fun getTrendingMovies() = list({ jf.resume(20).ifEmpty { jf.latest(20) } })
    override fun getTop10Movies() =
        list({ jf.items("IncludeItemTypes=Movie,Series&SortBy=CommunityRating&SortOrder=Descending&Limit=10") }, true)
    override fun getNowPlayingMovies() = list({ jf.latest(20) })
    override fun getMoviesWithLongThumbnail() =
        list({ jf.items("IncludeItemTypes=Movie&SortBy=DateCreated&SortOrder=Descending&Limit=20") }, true)
    override fun getMovies() =
        list({ jf.items("IncludeItemTypes=Movie&SortBy=SortName&Limit=200") })
    override fun getPopularFilmsThisWeek() =
        list({ jf.items("IncludeItemTypes=Movie&SortBy=PlayCount&SortOrder=Descending&Limit=20") })
    override fun getTVShows() =
        list({ jf.items("IncludeItemTypes=Series&SortBy=SortName&Limit=200") })
    override fun getBingeWatchDramas() =
        list({ jf.items("IncludeItemTypes=Series&Genres=Drama&Limit=20") })
    override fun getFavouriteMovies() =
        list({ jf.items("IncludeItemTypes=Movie,Series&Filters=IsFavorite&Limit=100") })

    override fun getMovieCategories(): Flow<MovieCategoryList> = flow {
        emit(runCatching { jf.genres() }.getOrDefault(emptyList()).map { MovieCategory(it.name, it.name) })
    }

    override suspend fun getMovieCategoryDetails(categoryId: String) = MovieCategoryDetails(
        id = categoryId,
        name = categoryId,
        movies = jf.items("IncludeItemTypes=Movie,Series&Genres=${jf.enc(categoryId)}&Limit=200").map { it.toMovie() }
    )

    override suspend fun searchMovies(query: String): MovieList =
        jf.items("IncludeItemTypes=Movie,Series&SearchTerm=${jf.enc(query)}&Limit=50").map { it.toMovie() }

    override suspend fun getMovieDetails(movieId: String): MovieDetails {
        val it = jf.item(movieId)
        val minutes = (it.runTimeTicks ?: 0L) / 600_000_000L
        val similar = runCatching {
            it.genres.firstOrNull()?.let { g ->
                jf.items("IncludeItemTypes=Movie,Series&Genres=${jf.enc(g)}&Limit=12")
                    .filter { s -> s.id != movieId }.map { s -> s.toMovie() }
            }
        }.getOrNull().orEmpty()
        fun crew(type: String) = it.people.filter { p -> p.type == type }.joinToString { p -> p.name }
        return MovieDetails(
            id = it.id,
            videoUri = jf.streamUrl(it.id),
            subtitleUri = null,
            posterUri = jf.imageUrl(it.id, "Backdrop", 1920),
            name = it.name,
            description = it.overview.orEmpty(),
            pgRating = it.officialRating.orEmpty(),
            releaseDate = it.premiereDate?.take(10) ?: it.year?.toString().orEmpty(),
            categories = it.genres,
            duration = if (minutes > 0) "${minutes / 60}h ${minutes % 60}m" else "",
            director = crew("Director"),
            screenplay = crew("Writer"),
            music = crew("Composer"),
            castAndCrew = it.people.filter { p -> p.type == "Actor" }.take(12).map { p ->
                MovieCast(p.id, p.role.orEmpty(), p.name, jf.imageUrl(p.id, "Primary", 200))
            },
            status = "Released",
            originalLanguage = "",
            budget = "",
            revenue = "",
            similarMovies = similar,
            reviewsAndRatings = emptyList()
        )
    }
}
