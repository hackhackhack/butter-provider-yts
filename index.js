'use strict';

var Q = require('q');
var request = require('request');
var inherits = require('util').inherits;
var _ = require('lodash');
var Generic = require('butter-provider');
var sanitize = require('butter-sanitize');

function YTS(args) {
    if (!(this instanceof YTS)) {
        return new YTS(args);
    }

    Generic.call(this);

    if (args.apiURL)
        this.apiURL = _.map(args.apiURL.split(','), function (url){
            return url;
        })

    this.quality = args.quality;
    this.translate = args.translate;
    this.language = args.language;
}
inherits(YTS, Generic);

YTS.prototype.config = {
    name: 'yts',
    uniqueId: 'imdb_id',
    tabName: 'YTS',
    type: 'movie',
    metadata: 'trakttv:movie-metadata'
};

YTS.prototype.extractIds = function (items) {
    return _.map(items.results, 'imdb_id');
};

var format = function (data) {
    var results = _.chain(data.movies)
        .filter(function (movie) {
            // Filter any 3D only movies
            return _.some(movie.torrents, function (torrent) {
                return torrent.quality !== '3D';
            });
        }).map(function (movie) {
            return {
                type: 'movie',
                imdb_id: movie.imdb_code,
                title: movie.title_english,
                year: movie.year,
                genre: movie.genres,
                rating: movie.rating,
                runtime: movie.runtime,
                image: movie.medium_cover_image,
                cover: movie.medium_cover_image,
                backdrop: movie.background_image_original,
                synopsis: movie.description_full,
                trailer: 'https://www.youtube.com/watch?v=' + movie.yt_trailer_code || false,
                certification: movie.mpa_rating,
                torrents: _.reduce(movie.torrents, function (torrents, torrent) {
                    if (torrent.quality !== '3D') {
                        torrents[torrent.quality] = {
                            url: torrent.url,
                            magnet: 'magnet:?xt=urn:btih:' + torrent.hash + '&tr=udp://glotorrents.pw:6969/announce&tr=udp://tracker.opentrackr.org:1337/announce&tr=udp://torrent.gresille.org:80/announce&tr=udp://tracker.openbittorrent.com:80&tr=udp://tracker.coppersurfer.tk:6969&tr=udp://tracker.leechers-paradise.org:6969&tr=udp://p4p.arenabg.ch:1337&tr=udp://tracker.internetwarriors.net:1337',
                            size: torrent.size_bytes,
                            filesize: torrent.size,
                            seed: torrent.seeds,
                            peer: torrent.peers
                        };
                    }
                    return torrents;
                }, {})
            };
        }).value();

    return {
        results: sanitize(results),
        hasMore: data.movie_count > data.page_number * data.limit
    };
};

var processCloudFlareHack = function (options, url) {
    var req = options;
    var match = url.match(/^cloudflare\+(.*):\/\/(.*)/)
    if (match) {
        req = _.extend(req, {
            uri: match[1] + '://cloudflare.com/',
            headers: {
                'Host': match[2],
                'User-Agent': 'Mozilla/5.0 (Linux) AppleWebkit/534.30 (KHTML, like Gecko) PT/3.8.0'
            }
        })
    }

    return req
}

YTS.prototype.fetch = function (filters) {
    var that = this;

    var params = {
        sort_by: 'seeds',
        limit: 50,
        with_rt_ratings: true
    };

    if (filters.page) {
        params.page = filters.page;
    }

    if (filters.keywords) {
        params.query_term = filters.keywords;
    }

    if (filters.genre && filters.genre !== 'All') {
        params.genre = filters.genre;
    }

    if (filters.order === 1) {
        params.order_by = 'asc';
    }

    if (filters.sorter && filters.sorter !== 'popularity') {
        switch (filters.sorter) {
        case 'last added':
            params.sort_by = 'date_added';
            break;
        case 'trending':
            params.sort_by = 'trending_score';
            break;
        default:
            params.sort_by = filters.sorter;
        }
    }

    if (this.quality !== 'all') {
        params.quality = this.quality;
    }

    if (this.translate) {
        params.lang = this.language;
    }

    var defer = Q.defer();

    function get(index) {
        var url = that.apiURL[index]
        var options = {
            uri: url + 'api/v2/list_movies.json',
            qs: params,
            json: true,
            timeout: 10000
        };

        var req = processCloudFlareHack(options, url)
        request(req, function (err, res, data) {
            if (err || res.statusCode >= 400 || (data && !data.data)) {
                console.warn('YTS API endpoint \'%s\' failed.', url);
                if (index + 1 >= that.apiURL.length) {
                    return defer.reject(err || 'Status Code is above 400');
                } else {
                    get(index + 1);
                }
                return;
            } else if (!data || data.status === 'error') {
                err = data ? data.status_message : 'No data returned';
                return defer.reject(err);
            } else {
                return defer.resolve(format(data.data));
            }
        });}
    get(0);

    return defer.promise;
};

YTS.prototype.random = function () {
    var that = this;
    var defer = Q.defer();

    function get(index) {
        var url = that.apiURL[index];
        var options = {
            uri: url + 'api/v2/get_random_movie.json?' + Math.round((new Date()).valueOf() / 1000),
            json: true,
            timeout: 10000
        };
        var req = processCloudFlareHack(options, url)
        request(req, function (err, res, data) {
            if (err || res.statusCode >= 400 || (data && !data.data)) {
                console.warn('YTS API endpoint \'%s\' failed.', url);
                if (index + 1 >= that.apiURL.length) {
                    return defer.reject(err || 'Status Code is above 400');
                } else {
                    get(index + 1);
                }
                return;
            } else if (!data || data.status === 'error') {
                err = data ? data.status_message : 'No data returned';
                return defer.reject(err);
            } else {
                return defer.resolve(sanitize(data.data));
            }
        });
    }
    get(0);

    return defer.promise;
};

YTS.prototype.detail = function (torrent_id, old_data) {
    return Q(old_data);
};

module.exports = YTS;
