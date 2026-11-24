package com.example.ticketreservation.service;

import com.example.ticketreservation.dto.EventRequest;
import com.example.ticketreservation.dto.EventResponse;
import com.example.ticketreservation.exception.ApiException;
import com.example.ticketreservation.model.Event;
import com.example.ticketreservation.model.ReservationStatus;
import com.example.ticketreservation.repository.EventRepository;
import com.example.ticketreservation.repository.ReservationRepository;
import org.springframework.data.mongodb.core.FindAndModifyOptions;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class EventService {

    private final EventRepository eventRepository;
    private final ReservationRepository reservationRepository;
    private final MongoTemplate mongoTemplate;

    public EventService(EventRepository eventRepository, ReservationRepository reservationRepository,
                        MongoTemplate mongoTemplate) {
        this.eventRepository = eventRepository;
        this.reservationRepository = reservationRepository;
        this.mongoTemplate = mongoTemplate;
    }

    public List<EventResponse> list(String search) {
        List<Event> events = (search == null || search.isBlank())
                ? eventRepository.findAll()
                : eventRepository.findByNameContainingIgnoreCase(search.trim());
        return events.stream().map(EventResponse::from).toList();
    }

    public EventResponse get(String id) {
        return EventResponse.from(findOrThrow(id));
    }

    public EventResponse create(EventRequest req, String organizerUsername) {
        Event event = Event.builder()
                .name(req.name())
                .description(req.description())
                .venue(req.venue())
                .eventDate(req.eventDate())
                .totalSeats(req.totalSeats())
                .availableSeats(req.totalSeats())
                .ticketPrice(req.ticketPrice())
                .organizer(organizerUsername)
                .build();
        return EventResponse.from(eventRepository.save(event));
    }

    /** ADMIN can edit any event; an ORGANIZER only their own. */
    public EventResponse update(String id, EventRequest req, Authentication auth) {
        Event event = findOrThrow(id);
        if (!isAdmin(auth) && !event.getOrganizer().equals(auth.getName())) {
            throw ApiException.forbidden("You can only edit your own events");
        }
        int booked = event.getTotalSeats() - event.getAvailableSeats();
        if (req.totalSeats() < booked) {
            throw ApiException.conflict("totalSeats cannot be less than the " + booked + " seats already reserved");
        }
        event.setName(req.name());
        event.setDescription(req.description());
        event.setVenue(req.venue());
        event.setEventDate(req.eventDate());
        event.setTotalSeats(req.totalSeats());
        event.setAvailableSeats(req.totalSeats() - booked);
        event.setTicketPrice(req.ticketPrice());
        return EventResponse.from(eventRepository.save(event));
    }

    public void delete(String id) {
        findOrThrow(id);
        if (reservationRepository.existsByEventIdAndStatus(id, ReservationStatus.CONFIRMED)) {
            throw ApiException.conflict("Event has confirmed reservations and cannot be deleted");
        }
        eventRepository.deleteById(id);
    }

    /**
     * Atomically takes seats: the filter (availableSeats >= seats) and the $inc happen in ONE
     * MongoDB operation, so two customers can never book the last seat at the same time.
     */
    public Event takeSeats(String eventId, int seats) {
        Query query = new Query(Criteria.where("_id").is(eventId)
                .and("availableSeats").gte(seats));
        Update update = new Update().inc("availableSeats", -seats);
        Event updated = mongoTemplate.findAndModify(query, update,
                FindAndModifyOptions.options().returnNew(true), Event.class);
        if (updated == null) {
            Event event = findOrThrow(eventId);
            throw ApiException.conflict("Only " + event.getAvailableSeats() + " seat(s) left for this event");
        }
        return updated;
    }

    public void releaseSeats(String eventId, int seats) {
        mongoTemplate.updateFirst(
                new Query(Criteria.where("_id").is(eventId)),
                new Update().inc("availableSeats", seats),
                Event.class);
    }

    public Event findOrThrow(String id) {
        return eventRepository.findById(id)
                .orElseThrow(() -> ApiException.notFound("Event not found: " + id));
    }

    public List<Event> findByOrganizer(String organizer) {
        return eventRepository.findByOrganizer(organizer);
    }

    private boolean isAdmin(Authentication auth) {
        return auth.getAuthorities().stream().anyMatch(a -> a.getAuthority().equals("ROLE_ADMIN"));
    }
}
