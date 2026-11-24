package com.example.ticketreservation.service;

import com.example.ticketreservation.dto.ReservationRequest;
import com.example.ticketreservation.dto.ReservationResponse;
import com.example.ticketreservation.dto.ReservationUpdateRequest;
import com.example.ticketreservation.exception.ApiException;
import com.example.ticketreservation.model.Event;
import com.example.ticketreservation.model.Reservation;
import com.example.ticketreservation.model.ReservationStatus;
import com.example.ticketreservation.repository.ReservationRepository;
import org.springframework.data.mongodb.core.FindAndModifyOptions;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

@Service
public class ReservationService {

    private final ReservationRepository reservationRepository;
    private final EventService eventService;
    private final MongoTemplate mongoTemplate;

    public ReservationService(ReservationRepository reservationRepository, EventService eventService,
                              MongoTemplate mongoTemplate) {
        this.reservationRepository = reservationRepository;
        this.eventService = eventService;
        this.mongoTemplate = mongoTemplate;
    }

    public ReservationResponse book(ReservationRequest req, String customerUsername) {
        // 1. atomic seat decrement (fails with 404 / 409 if event missing or not enough seats)
        Event event = eventService.takeSeats(req.eventId(), req.seats());

        // 2. create the reservation; if that fails, put the seats back
        try {
            Reservation saved = reservationRepository.save(Reservation.builder()
                    .reservationCode("TKT-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase())
                    .eventId(event.getId())
                    .eventName(event.getName())
                    .customer(customerUsername)
                    .seats(req.seats())
                    .totalAmount(event.getTicketPrice() * req.seats())
                    .status(ReservationStatus.CONFIRMED)
                    .createdAt(LocalDateTime.now())
                    .build());
            return ReservationResponse.from(saved);
        } catch (RuntimeException ex) {
            eventService.releaseSeats(event.getId(), req.seats());
            throw ex;
        }
    }

    public List<ReservationResponse> myReservations(String username) {
        return reservationRepository.findByCustomer(username).stream()
                .map(ReservationResponse::from).toList();
    }

    /** ADMIN sees every reservation; an ORGANIZER only those for their own events. */
    public List<ReservationResponse> listForStaff(Authentication auth) {
        List<Reservation> reservations;
        if (isAdmin(auth)) {
            reservations = reservationRepository.findAll();
        } else {
            List<String> eventIds = eventService.findByOrganizer(auth.getName()).stream()
                    .map(Event::getId).toList();
            reservations = eventIds.isEmpty() ? List.of() : reservationRepository.findByEventIdIn(eventIds);
        }
        return reservations.stream().map(ReservationResponse::from).toList();
    }

    /**
     * Changes the number of seats of a CONFIRMED reservation (CUSTOMER: own, ADMIN: any).
     * Taking extra seats and releasing seats are both atomic MongoDB updates, so the seat counter
     * on the event can never go wrong, even when several people book at the same time.
     */
    public ReservationResponse update(String id, ReservationUpdateRequest req, Authentication auth) {
        Reservation reservation = reservationRepository.findById(id)
                .orElseThrow(() -> ApiException.notFound("Reservation not found: " + id));

        if (!isAdmin(auth) && !reservation.getCustomer().equals(auth.getName())) {
            throw ApiException.forbidden("You can only change your own reservations");
        }
        if (reservation.getStatus() != ReservationStatus.CONFIRMED) {
            throw ApiException.conflict("Only a CONFIRMED reservation can be changed");
        }

        int oldSeats = reservation.getSeats();
        int newSeats = req.seats();
        if (newSeats == oldSeats) {
            return ReservationResponse.from(reservation);
        }
        int diff = newSeats - oldSeats;
        // keep the price the customer originally booked at, even if the organizer edited the price later
        double unitPrice = reservation.getTotalAmount() / oldSeats;

        // more seats wanted: take the extra seats first (409 if not enough are left)
        if (diff > 0) {
            eventService.takeSeats(reservation.getEventId(), diff);
        }

        // change the reservation only if nobody changed / cancelled it in the meantime
        Reservation updated = mongoTemplate.findAndModify(
                new Query(Criteria.where("_id").is(id)
                        .and("status").is(ReservationStatus.CONFIRMED)
                        .and("seats").is(oldSeats)),
                new Update().set("seats", newSeats).set("totalAmount", unitPrice * newSeats),
                FindAndModifyOptions.options().returnNew(true),
                Reservation.class);

        if (updated == null) {
            if (diff > 0) {
                eventService.releaseSeats(reservation.getEventId(), diff);
            }
            throw ApiException.conflict("Reservation was changed by someone else, please reload and try again");
        }

        // fewer seats wanted: give the difference back
        if (diff < 0) {
            eventService.releaseSeats(reservation.getEventId(), -diff);
        }
        return ReservationResponse.from(updated);
    }

    /** CUSTOMER may cancel only their own reservation; ADMIN may cancel any. */
    public ReservationResponse cancel(String id, Authentication auth) {
        Reservation reservation = reservationRepository.findById(id)
                .orElseThrow(() -> ApiException.notFound("Reservation not found: " + id));

        if (!isAdmin(auth) && !reservation.getCustomer().equals(auth.getName())) {
            throw ApiException.forbidden("You can only cancel your own reservations");
        }

        // atomic CONFIRMED -> CANCELLED so seats can never be released twice
        Reservation cancelled = mongoTemplate.findAndModify(
                new Query(Criteria.where("_id").is(id).and("status").is(ReservationStatus.CONFIRMED)),
                new Update().set("status", ReservationStatus.CANCELLED),
                FindAndModifyOptions.options().returnNew(true),
                Reservation.class);
        if (cancelled == null) {
            throw ApiException.conflict("Reservation is already cancelled");
        }

        eventService.releaseSeats(cancelled.getEventId(), cancelled.getSeats());
        return ReservationResponse.from(cancelled);
    }

    private boolean isAdmin(Authentication auth) {
        return auth.getAuthorities().stream().anyMatch(a -> a.getAuthority().equals("ROLE_ADMIN"));
    }
}
