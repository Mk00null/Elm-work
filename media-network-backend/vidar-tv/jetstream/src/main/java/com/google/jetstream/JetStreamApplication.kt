/*
 * Copyright 2023 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.google.jetstream

import android.app.Application
import com.google.jetstream.data.repositories.MovieRepository
import com.google.jetstream.data.repositories.MovieRepositoryImpl
import android.content.Context
import com.google.jetstream.data.jellyfin.JellyfinClient
import com.google.jetstream.data.jellyfin.JellyfinConfig
import com.google.jetstream.data.jellyfin.JellyfinMovieRepository
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.HiltAndroidApp
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@HiltAndroidApp
class JetStreamApplication : Application()

@InstallIn(SingletonComponent::class)
@Module
object MovieRepositoryModule {

    /** Vidar: use Jellyfin when configured in vidar_config.xml, else the sample catalog. */
    @Provides
    @Singleton
    fun provideMovieRepository(
        @ApplicationContext context: Context,
        sample: MovieRepositoryImpl
    ): MovieRepository {
        val config = JellyfinConfig(
            serverUrl = context.getString(R.string.jellyfin_server_url),
            username = context.getString(R.string.jellyfin_username),
            password = context.getString(R.string.jellyfin_password),
            deviceName = context.getString(R.string.vidar_device_name)
        )
        return if (config.enabled) JellyfinMovieRepository(JellyfinClient(config)) else sample
    }
}
